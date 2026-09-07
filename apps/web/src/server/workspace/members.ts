/**
 * Membership lifecycle: list, approve, change role, suspend, remove, leave,
 * transfer ownership. The escalation rules come from `~/lib/authz/escalation`
 * so this file only has to gather the facts they need.
 */

import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";

import { db } from "~/server/db";
import {
    documentGrants,
    folderGrants,
    userCompanyMemberships,
    users,
    workspaceGroupMembers,
    workspaceGroups,
} from "~/server/db/schema";
import type { WorkspaceContext } from "~/lib/require-workspace-context";
import { recordAuditEvent } from "~/lib/authz/audit";
import {
    canActOnMember,
    canAssignRole,
    isOwner,
    wouldRemoveLastOwner,
} from "~/lib/authz/escalation";
import {
    isMembershipStatus,
    normalizeRoleSlug,
    roleRank,
    type MembershipStatus,
} from "~/lib/authz/permissions";

import type { Executor } from "./db-types";
import { badRequest, conflict, forbidden, notFound } from "./errors";
import { customRoleNames, displayRoleName, requireKnownRole } from "./roles";

export interface MemberView {
    id: number;
    authUserId: string;
    name: string;
    email: string;
    role: string;
    roleName: string;
    status: MembershipStatus;
    groups: { id: number; name: string }[];
    joinedAt: string;
    lastActiveAt: string | null;
    isSelf: boolean;
}

export interface MemberCounts {
    active: number;
    pending: number;
    suspended: number;
}

const STATUS_ORDER: Record<MembershipStatus, number> = { pending: 0, active: 1, suspended: 2 };

function toStatus(raw: string): MembershipStatus {
    return isMembershipStatus(raw) ? raw : "active";
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

interface MemberRow {
    id: number;
    authUserId: string;
    name: string;
    email: string;
    role: string;
    status: string;
    joinedAt: Date;
    lastActiveAt: Date | null;
}

async function memberRows(companyId: bigint, userId?: bigint): Promise<MemberRow[]> {
    return db
        .select({
            id: users.id,
            authUserId: users.userId,
            name: users.name,
            email: users.email,
            role: userCompanyMemberships.role,
            status: userCompanyMemberships.status,
            joinedAt: userCompanyMemberships.createdAt,
            lastActiveAt: users.lastActiveAt,
        })
        .from(userCompanyMemberships)
        .innerJoin(users, eq(users.id, userCompanyMemberships.userId))
        .where(
            userId === undefined
                ? eq(userCompanyMemberships.companyId, companyId)
                : and(
                      eq(userCompanyMemberships.companyId, companyId),
                      eq(userCompanyMemberships.userId, userId)
                  )
        );
}

/** userId → the workspace's groups they belong to. */
async function groupsByUser(
    companyId: bigint,
    userIds: readonly bigint[]
): Promise<Map<string, { id: number; name: string }[]>> {
    const out = new Map<string, { id: number; name: string }[]>();
    if (userIds.length === 0) return out;
    const rows = await db
        .select({
            userId: workspaceGroupMembers.userId,
            groupId: workspaceGroups.id,
            name: workspaceGroups.name,
        })
        .from(workspaceGroupMembers)
        .innerJoin(workspaceGroups, eq(workspaceGroups.id, workspaceGroupMembers.groupId))
        .where(
            and(
                eq(workspaceGroups.companyId, companyId),
                inArray(workspaceGroupMembers.userId, [...userIds])
            )
        );
    for (const row of rows) {
        const key = row.userId.toString();
        const list = out.get(key) ?? [];
        list.push({ id: Number(row.groupId), name: row.name });
        out.set(key, list);
    }
    for (const list of out.values()) list.sort((a, b) => a.name.localeCompare(b.name));
    return out;
}

async function toMemberViews(ctx: WorkspaceContext, rows: MemberRow[]): Promise<MemberView[]> {
    const [names, groups] = await Promise.all([
        customRoleNames(ctx.companyId),
        groupsByUser(
            ctx.companyId,
            rows.map(r => BigInt(r.id))
        ),
    ]);
    return rows.map(row => {
        const role = normalizeRoleSlug(row.role);
        return {
            id: Number(row.id),
            authUserId: row.authUserId,
            name: row.name,
            email: row.email,
            role,
            roleName: displayRoleName(role, names),
            status: toStatus(row.status),
            groups: groups.get(String(row.id)) ?? [],
            joinedAt: row.joinedAt.toISOString(),
            lastActiveAt: row.lastActiveAt ? row.lastActiveAt.toISOString() : null,
            isSelf: BigInt(row.id) === ctx.userPk,
        };
    });
}

export async function listMembers(
    ctx: WorkspaceContext
): Promise<{ members: MemberView[]; counts: MemberCounts }> {
    const members = await toMemberViews(ctx, await memberRows(ctx.companyId));
    members.sort(
        (a, b) =>
            STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
            roleRank(b.role) - roleRank(a.role) ||
            a.name.localeCompare(b.name)
    );
    const counts: MemberCounts = { active: 0, pending: 0, suspended: 0 };
    for (const m of members) counts[m.status] += 1;
    return { members, counts };
}

export async function getMember(ctx: WorkspaceContext, userId: bigint): Promise<MemberView> {
    const rows = await memberRows(ctx.companyId, userId);
    const [member] = await toMemberViews(ctx, rows);
    if (!member) throw notFound("Member not found.");
    return member;
}

async function loadTarget(companyId: bigint, userId: bigint): Promise<MemberRow> {
    const [row] = await memberRows(companyId, userId);
    if (!row) throw notFound("Member not found.");
    return row;
}

async function countActiveOwners(companyId: bigint): Promise<number> {
    const rows = await db
        .select({ userId: userCompanyMemberships.userId })
        .from(userCompanyMemberships)
        .where(
            and(
                eq(userCompanyMemberships.companyId, companyId),
                eq(userCompanyMemberships.role, "owner"),
                eq(userCompanyMemberships.status, "active")
            )
        );
    return rows.length;
}

async function assertNotLastOwner(companyId: bigint, target: MemberRow): Promise<void> {
    const targetIsOwner = isOwner(target.role) && toStatus(target.status) === "active";
    if (!targetIsOwner) return;
    const activeOwnerCount = await countActiveOwners(companyId);
    if (wouldRemoveLastOwner({ targetIsOwner, activeOwnerCount })) {
        throw conflict("A workspace must keep at least one owner. Transfer ownership first.");
    }
}

// ---------------------------------------------------------------------------
// Role and status changes
// ---------------------------------------------------------------------------

export async function updateMember(
    ctx: WorkspaceContext,
    userId: bigint,
    input: { role?: string; status?: "active" | "suspended" }
): Promise<MemberView> {
    if (input.role === undefined && input.status === undefined) {
        throw badRequest("Nothing to change.");
    }
    if (userId === ctx.userPk) throw forbidden("You cannot change your own membership.");

    const target = await loadTarget(ctx.companyId, userId);
    if (!canActOnMember(ctx, target.role, userId)) {
        throw forbidden("You cannot change this member's membership.");
    }

    const currentRole = normalizeRoleSlug(target.role);
    const currentStatus = toStatus(target.status);

    let nextRole = currentRole;
    if (input.role !== undefined) {
        const resolved = await requireKnownRole(ctx.companyId, input.role);
        nextRole = resolved.slug;
        if (nextRole !== currentRole) {
            if (nextRole === "owner") {
                throw badRequest("Ownership is transferred, never assigned.");
            }
            if (!canAssignRole(ctx, resolved)) {
                throw forbidden("You cannot assign a role with permissions you do not hold.");
            }
        }
    }
    const nextStatus: MembershipStatus = input.status ?? currentStatus;

    const losesOwner =
        (nextRole !== currentRole && currentRole === "owner") ||
        (nextStatus !== "active" && currentStatus === "active" && currentRole === "owner");
    if (losesOwner) await assertNotLastOwner(ctx.companyId, target);

    const roleChanged = nextRole !== currentRole;
    const statusChanged = nextStatus !== currentStatus;
    if (!roleChanged && !statusChanged) return getMember(ctx, userId);

    await db.transaction(async tx => {
        await tx
            .update(userCompanyMemberships)
            .set({
                ...(roleChanged ? { role: nextRole } : {}),
                ...(statusChanged ? { status: nextStatus } : {}),
            })
            .where(
                and(
                    eq(userCompanyMemberships.companyId, ctx.companyId),
                    eq(userCompanyMemberships.userId, userId)
                )
            );
        if (roleChanged) {
            await recordAuditEvent(tx, {
                companyId: ctx.companyId,
                actorUserId: ctx.authUserId,
                action: "member.role_changed",
                targetType: "member",
                targetId: userId,
                detail: { name: target.name, email: target.email, from: currentRole, to: nextRole },
            });
        }
        if (statusChanged) {
            const action =
                nextStatus === "suspended"
                    ? "member.suspended"
                    : currentStatus === "pending"
                      ? "member.approved"
                      : "member.reinstated";
            await recordAuditEvent(tx, {
                companyId: ctx.companyId,
                actorUserId: ctx.authUserId,
                action,
                targetType: "member",
                targetId: userId,
                detail: {
                    name: target.name,
                    email: target.email,
                    from: currentStatus,
                    to: nextStatus,
                },
            });
        }
    });

    return getMember(ctx, userId);
}

// ---------------------------------------------------------------------------
// Removal
// ---------------------------------------------------------------------------

/**
 * Everything a departed member leaves behind in this workspace: the
 * membership, their group seats, and grants naming them. The `users` row
 * stays; if it pointed at this workspace as its default, it is repointed at
 * another workspace they still belong to.
 */
async function deleteMembershipEverywhere(
    tx: Executor,
    companyId: bigint,
    userId: bigint
): Promise<void> {
    await tx
        .delete(userCompanyMemberships)
        .where(
            and(
                eq(userCompanyMemberships.companyId, companyId),
                eq(userCompanyMemberships.userId, userId)
            )
        );

    const groups = await tx
        .select({ id: workspaceGroups.id })
        .from(workspaceGroups)
        .where(eq(workspaceGroups.companyId, companyId));
    if (groups.length > 0) {
        await tx.delete(workspaceGroupMembers).where(
            and(
                eq(workspaceGroupMembers.userId, userId),
                inArray(
                    workspaceGroupMembers.groupId,
                    groups.map(g => BigInt(g.id))
                )
            )
        );
    }

    const principalId = userId.toString();
    await tx
        .delete(folderGrants)
        .where(
            and(
                eq(folderGrants.companyId, companyId),
                eq(folderGrants.principalType, "user"),
                eq(folderGrants.principalId, principalId)
            )
        );
    await tx
        .delete(documentGrants)
        .where(
            and(
                eq(documentGrants.companyId, companyId),
                eq(documentGrants.principalType, "user"),
                eq(documentGrants.principalId, principalId)
            )
        );

    const [user] = await tx
        .select({ defaultCompanyId: users.companyId })
        .from(users)
        .where(eq(users.id, Number(userId)))
        .limit(1);
    if (user && user.defaultCompanyId === companyId) {
        const [other] = await tx
            .select({ companyId: userCompanyMemberships.companyId })
            .from(userCompanyMemberships)
            .where(
                and(
                    eq(userCompanyMemberships.userId, userId),
                    ne(userCompanyMemberships.companyId, companyId)
                )
            )
            .orderBy(desc(userCompanyMemberships.lastOpenedAt))
            .limit(1);
        if (other) {
            await tx
                .update(users)
                .set({ companyId: other.companyId })
                .where(eq(users.id, Number(userId)));
        }
    }
}

export async function removeMember(
    ctx: WorkspaceContext,
    userId: bigint
): Promise<{ success: true }> {
    if (userId === ctx.userPk) throw forbidden("Use “leave workspace” to remove yourself.");
    const target = await loadTarget(ctx.companyId, userId);
    if (!canActOnMember(ctx, target.role, userId)) {
        throw forbidden("You cannot remove this member.");
    }
    await assertNotLastOwner(ctx.companyId, target);

    await db.transaction(async tx => {
        await deleteMembershipEverywhere(tx, ctx.companyId, userId);
        await recordAuditEvent(tx, {
            companyId: ctx.companyId,
            actorUserId: ctx.authUserId,
            action: "member.removed",
            targetType: "member",
            targetId: userId,
            detail: {
                name: target.name,
                email: target.email,
                role: normalizeRoleSlug(target.role),
                status: toStatus(target.status),
            },
        });
    });
    return { success: true };
}

export async function leaveWorkspace(
    ctx: WorkspaceContext
): Promise<{ success: true; redirectTo: string }> {
    if (isOwner(ctx.role)) {
        const owners = await countActiveOwners(ctx.companyId);
        if (wouldRemoveLastOwner({ targetIsOwner: true, activeOwnerCount: owners })) {
            throw conflict("You are the only owner. Transfer ownership before leaving.");
        }
    }

    await db.transaction(async tx => {
        await deleteMembershipEverywhere(tx, ctx.companyId, ctx.userPk);
        await recordAuditEvent(tx, {
            companyId: ctx.companyId,
            actorUserId: ctx.authUserId,
            action: "member.left",
            targetType: "member",
            targetId: ctx.userPk,
            detail: { role: ctx.role },
        });
    });
    return { success: true, redirectTo: "/workspaces" };
}

// ---------------------------------------------------------------------------
// Ownership
// ---------------------------------------------------------------------------

export async function transferOwnership(
    ctx: WorkspaceContext,
    targetUserId: bigint
): Promise<{ success: true }> {
    if (!isOwner(ctx.role)) throw forbidden("Only an owner can transfer ownership.");
    if (targetUserId === ctx.userPk) throw badRequest("You already own this workspace.");

    const target = await loadTarget(ctx.companyId, targetUserId);
    if (toStatus(target.status) !== "active") {
        throw conflict("Ownership can only go to an active member.");
    }
    const targetRole = normalizeRoleSlug(target.role);

    await db.transaction(async tx => {
        await tx
            .update(userCompanyMemberships)
            .set({ role: "owner" })
            .where(
                and(
                    eq(userCompanyMemberships.companyId, ctx.companyId),
                    eq(userCompanyMemberships.userId, targetUserId)
                )
            );
        await tx
            .update(userCompanyMemberships)
            .set({ role: "admin", updatedAt: sql`CURRENT_TIMESTAMP` })
            .where(
                and(
                    eq(userCompanyMemberships.companyId, ctx.companyId),
                    eq(userCompanyMemberships.userId, ctx.userPk)
                )
            );
        await recordAuditEvent(tx, {
            companyId: ctx.companyId,
            actorUserId: ctx.authUserId,
            action: "ownership.transferred",
            targetType: "member",
            targetId: targetUserId,
            detail: {
                name: target.name,
                email: target.email,
                from: ctx.userPk.toString(),
                to: targetUserId.toString(),
                previousRole: targetRole,
            },
        });
    });
    return { success: true };
}
