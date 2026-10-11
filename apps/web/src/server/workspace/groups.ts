/**
 * Groups: a named set of members that grants can name as one principal.
 * Deleting a group takes its grants with it, so nothing keeps pointing at an
 * id that no longer exists.
 *
 * Who may change a group (ADR-014): anyone who can see the member list and is
 * not a Guest may create one, and becomes its manager. The creator manages
 * their group — rename, delete, add and remove people; `groups.manage`
 * manages every group.
 */

import { and, asc, eq, inArray } from "drizzle-orm";

import { db } from "~/server/db";
import {
    documentGrants,
    folderGrants,
    userCompanyMemberships,
    users,
    workspaceGroupMembers,
    workspaceGroups,
    workspaceSessionGrants,
} from "~/server/db/schema";
import type { WorkspaceContext } from "~/lib/require-workspace-context";
import { recordAuditEvent } from "~/lib/authz/audit";
import { normalizeRoleSlug } from "~/lib/authz/permissions";
import { slugifyName } from "~/lib/workspace-slug";

import { recordActivity } from "./activity";
import { badRequest, forbidden, notFound } from "./errors";

export interface GroupView {
    id: number;
    name: string;
    slug: string;
    description: string | null;
    memberCount: number;
    members: { id: number; name: string; email: string }[];
    /** Auth subject id of whoever created it — its manager. */
    createdBy: string;
    /** May the caller rename, delete, or change who is in it. */
    canManage: boolean;
}

interface GroupRow {
    id: number;
    name: string;
    slug: string;
    description: string | null;
    createdBy: string;
}

type GroupActor = Pick<WorkspaceContext, "authUserId" | "role" | "can">;

// ---------------------------------------------------------------------------
// Who may do what
// ---------------------------------------------------------------------------

/** Anyone who sees the member list and is not a Guest may start a group. */
export function canCreateGroups(ctx: GroupActor): boolean {
    if (ctx.can("groups.manage")) return true;
    return ctx.can("members.view") && normalizeRoleSlug(ctx.role) !== "guest";
}

/** The creator manages their group (while they may still create groups); `groups.manage` manages all. */
export function canManageGroup(ctx: GroupActor, group: { createdBy: string }): boolean {
    if (ctx.can("groups.manage")) return true;
    return group.createdBy === ctx.authUserId && canCreateGroups(ctx);
}

function assertCanManage(ctx: GroupActor, group: GroupRow): void {
    if (!canManageGroup(ctx, group)) {
        throw forbidden("Only the person who created this group, or an admin, can change it.");
    }
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

async function membersByGroup(
    groupIds: readonly number[]
): Promise<Map<number, GroupView["members"]>> {
    const out = new Map<number, GroupView["members"]>();
    if (groupIds.length === 0) return out;
    const rows = await db
        .select({
            groupId: workspaceGroupMembers.groupId,
            id: users.id,
            name: users.name,
            email: users.email,
        })
        .from(workspaceGroupMembers)
        .innerJoin(users, eq(users.id, workspaceGroupMembers.userId))
        .where(
            inArray(
                workspaceGroupMembers.groupId,
                groupIds.map(id => BigInt(id))
            )
        )
        .orderBy(asc(users.name));
    for (const row of rows) {
        const key = Number(row.groupId);
        const list = out.get(key) ?? [];
        list.push({ id: Number(row.id), name: row.name, email: row.email });
        out.set(key, list);
    }
    return out;
}

async function toViews(ctx: GroupActor, rows: readonly GroupRow[]): Promise<GroupView[]> {
    const members = await membersByGroup(rows.map(r => Number(r.id)));
    return rows.map(row => {
        const list = members.get(Number(row.id)) ?? [];
        return {
            id: Number(row.id),
            name: row.name,
            slug: row.slug,
            description: row.description,
            memberCount: list.length,
            members: list,
            createdBy: row.createdBy,
            canManage: canManageGroup(ctx, row),
        };
    });
}

const GROUP_COLUMNS = {
    id: workspaceGroups.id,
    name: workspaceGroups.name,
    slug: workspaceGroups.slug,
    description: workspaceGroups.description,
    createdBy: workspaceGroups.createdBy,
};

export async function listGroups(ctx: WorkspaceContext): Promise<GroupView[]> {
    const rows = await db
        .select(GROUP_COLUMNS)
        .from(workspaceGroups)
        .where(eq(workspaceGroups.companyId, ctx.companyId))
        .orderBy(asc(workspaceGroups.name));
    return toViews(ctx, rows);
}

async function loadGroup(companyId: bigint, id: number): Promise<GroupRow> {
    const [row] = await db
        .select(GROUP_COLUMNS)
        .from(workspaceGroups)
        .where(and(eq(workspaceGroups.companyId, companyId), eq(workspaceGroups.id, id)))
        .limit(1);
    if (!row) throw notFound("Group not found.");
    return row;
}

/** The group, if the caller may change it: 404 for another workspace's, 403 for someone else's. */
async function loadManagedGroup(ctx: WorkspaceContext, id: number): Promise<GroupRow> {
    const row = await loadGroup(ctx.companyId, id);
    assertCanManage(ctx, row);
    return row;
}

async function getGroup(ctx: WorkspaceContext, id: number): Promise<GroupView> {
    const [view] = await toViews(ctx, [await loadGroup(ctx.companyId, id)]);
    if (!view) throw notFound("Group not found.");
    return view;
}

async function uniqueGroupSlug(companyId: bigint, name: string): Promise<string> {
    const base = slugifyName(name).slice(0, 56).replace(/-+$/, "") || "group";
    const rows = await db
        .select({ slug: workspaceGroups.slug })
        .from(workspaceGroups)
        .where(eq(workspaceGroups.companyId, companyId));
    const taken = new Set(rows.map(r => r.slug));
    if (!taken.has(base)) return base;
    for (let n = 2; n < 1000; n++) {
        const candidate = `${base}-${n}`;
        if (!taken.has(candidate)) return candidate;
    }
    return `${base}-${Date.now().toString(36)}`;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function createGroup(
    ctx: WorkspaceContext,
    input: { name: string; description?: string | null }
): Promise<GroupView> {
    if (!canCreateGroups(ctx)) throw forbidden("Your role can't create groups.");
    const slug = await uniqueGroupSlug(ctx.companyId, input.name);
    const id = await db.transaction(async tx => {
        const [row] = await tx
            .insert(workspaceGroups)
            .values({
                companyId: ctx.companyId,
                name: input.name,
                slug,
                description: input.description ?? null,
                createdBy: ctx.authUserId,
            })
            .returning({ id: workspaceGroups.id });
        if (!row) throw new Error("Group insert returned no row");
        await recordAuditEvent(tx, {
            companyId: ctx.companyId,
            actorUserId: ctx.authUserId,
            action: "group.created",
            targetType: "group",
            targetId: row.id,
            detail: { name: input.name, slug },
        });
        await recordActivity(tx, {
            companyId: ctx.companyId,
            actorUserId: ctx.authUserId,
            verb: "created_group",
            targetType: "group",
            targetId: row.id,
            targetLabel: input.name,
        });
        return row.id;
    });
    return getGroup(ctx, id);
}

export async function updateGroup(
    ctx: WorkspaceContext,
    id: number,
    input: { name?: string; description?: string | null }
): Promise<GroupView> {
    const row = await loadManagedGroup(ctx, id);
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    if (input.name !== undefined && input.name !== row.name) {
        changes.name = { from: row.name, to: input.name };
    }
    if (input.description !== undefined && (input.description ?? null) !== row.description) {
        changes.description = { from: row.description, to: input.description ?? null };
    }
    if (Object.keys(changes).length === 0) return getGroup(ctx, id);

    await db.transaction(async tx => {
        await tx
            .update(workspaceGroups)
            .set({
                ...(input.name !== undefined ? { name: input.name } : {}),
                ...(input.description !== undefined
                    ? { description: input.description ?? null }
                    : {}),
            })
            .where(eq(workspaceGroups.id, id));
        await recordAuditEvent(tx, {
            companyId: ctx.companyId,
            actorUserId: ctx.authUserId,
            action: "group.updated",
            targetType: "group",
            targetId: id,
            detail: { changes },
        });
    });
    return getGroup(ctx, id);
}

export async function deleteGroup(
    ctx: WorkspaceContext,
    id: number
): Promise<{ success: true; removedGrants: number }> {
    const row = await loadManagedGroup(ctx, id);
    const principalId = String(id);

    const removedGrants = await db.transaction(async tx => {
        const folder = await tx
            .delete(folderGrants)
            .where(
                and(
                    eq(folderGrants.companyId, ctx.companyId),
                    eq(folderGrants.principalType, "group"),
                    eq(folderGrants.principalId, principalId)
                )
            )
            .returning({ id: folderGrants.id });
        const docs = await tx
            .delete(documentGrants)
            .where(
                and(
                    eq(documentGrants.companyId, ctx.companyId),
                    eq(documentGrants.principalType, "group"),
                    eq(documentGrants.principalId, principalId)
                )
            )
            .returning({ id: documentGrants.id });
        const chats = await tx
            .delete(workspaceSessionGrants)
            .where(
                and(
                    eq(workspaceSessionGrants.companyId, ctx.companyId),
                    eq(workspaceSessionGrants.principalType, "group"),
                    eq(workspaceSessionGrants.principalId, principalId)
                )
            )
            .returning({ id: workspaceSessionGrants.id });
        await tx.delete(workspaceGroups).where(eq(workspaceGroups.id, id));
        const removed = folder.length + docs.length + chats.length;
        await recordAuditEvent(tx, {
            companyId: ctx.companyId,
            actorUserId: ctx.authUserId,
            action: "group.deleted",
            targetType: "group",
            targetId: id,
            detail: { name: row.name, removedGrants: removed },
        });
        return removed;
    });

    return { success: true, removedGrants };
}

export async function addGroupMembers(
    ctx: WorkspaceContext,
    id: number,
    userIds: readonly number[]
): Promise<GroupView> {
    await loadManagedGroup(ctx, id);
    const unique = [...new Set(userIds)];
    if (unique.length === 0) return getGroup(ctx, id);

    const active = await db
        .select({ userId: userCompanyMemberships.userId })
        .from(userCompanyMemberships)
        .where(
            and(
                eq(userCompanyMemberships.companyId, ctx.companyId),
                eq(userCompanyMemberships.status, "active"),
                inArray(
                    userCompanyMemberships.userId,
                    unique.map(u => BigInt(u))
                )
            )
        );
    const activeIds = new Set(active.map(r => r.userId.toString()));
    const missing = unique.filter(u => !activeIds.has(String(u)));
    if (missing.length > 0) {
        throw badRequest(`User ${missing[0]} is not an active member of this workspace.`);
    }

    const current = await db
        .select({ userId: workspaceGroupMembers.userId })
        .from(workspaceGroupMembers)
        .where(
            and(
                eq(workspaceGroupMembers.groupId, BigInt(id)),
                inArray(
                    workspaceGroupMembers.userId,
                    unique.map(u => BigInt(u))
                )
            )
        );
    const currentIds = new Set(current.map(r => r.userId.toString()));
    const toAdd = unique.filter(u => !currentIds.has(String(u)));

    if (toAdd.length > 0) {
        await db.transaction(async tx => {
            await tx
                .insert(workspaceGroupMembers)
                .values(
                    toAdd.map(u => ({
                        groupId: BigInt(id),
                        userId: BigInt(u),
                        addedBy: ctx.authUserId,
                    }))
                )
                .onConflictDoNothing();
            for (const u of toAdd) {
                await recordAuditEvent(tx, {
                    companyId: ctx.companyId,
                    actorUserId: ctx.authUserId,
                    action: "group.member_added",
                    targetType: "group",
                    targetId: id,
                    detail: { userId: u },
                });
            }
        });
    }
    return getGroup(ctx, id);
}

export async function removeGroupMembers(
    ctx: WorkspaceContext,
    id: number,
    userIds: readonly number[]
): Promise<GroupView> {
    await loadManagedGroup(ctx, id);
    const unique = [...new Set(userIds)];
    if (unique.length > 0) {
        await db.transaction(async tx => {
            const removed = await tx
                .delete(workspaceGroupMembers)
                .where(
                    and(
                        eq(workspaceGroupMembers.groupId, BigInt(id)),
                        inArray(
                            workspaceGroupMembers.userId,
                            unique.map(u => BigInt(u))
                        )
                    )
                )
                .returning({ userId: workspaceGroupMembers.userId });
            for (const r of removed) {
                await recordAuditEvent(tx, {
                    companyId: ctx.companyId,
                    actorUserId: ctx.authUserId,
                    action: "group.member_removed",
                    targetType: "group",
                    targetId: id,
                    detail: { userId: Number(r.userId) },
                });
            }
        });
    }
    return getGroup(ctx, id);
}
