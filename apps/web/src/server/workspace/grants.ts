/**
 * What folder and document access share: principal validation and naming,
 * the grant diff, and the honest audience count — who, of the active
 * members, can actually see the thing, by the same rules `resolveDocumentScope`
 * applies at read time.
 */

import { and, eq, inArray } from "drizzle-orm";

import { db } from "~/server/db";
import {
    userCompanyMemberships,
    users,
    workspaceGroupMembers,
    workspaceGroups,
    workspaceRoles,
} from "~/server/db/schema";
import type { WorkspaceContext } from "~/lib/require-workspace-context";
import {
    grantLevelAtLeast,
    isBuiltinRole,
    isGrantLevel,
    isPrincipalType,
    normalizeRoleSlug,
    roleLabel,
    type GrantLevel,
    type Permission,
    type PrincipalType,
} from "~/lib/authz/permissions";

import { badRequest } from "./errors";
import { customRoleNames, permissionsForRoles } from "./roles";

export interface GrantInput {
    principalType: PrincipalType;
    principalId: string;
    level: GrantLevel;
}

export interface GrantRow {
    id: number;
    principalType: string;
    principalId: string;
    level: string;
}

export interface GrantView {
    id: number;
    principalType: PrincipalType;
    principalId: string;
    principalName: string;
    level: GrantLevel;
}

type PrincipalRef = { principalType: string; principalId: string };

export const grantKey = (g: PrincipalRef): string => `${g.principalType}:${g.principalId}`;

const PRINCIPAL_ORDER: Record<PrincipalType, number> = { user: 0, group: 1, role: 2 };

// ---------------------------------------------------------------------------
// Validation and naming
// ---------------------------------------------------------------------------

/**
 * Normalises and de-duplicates a requested grant set and checks every
 * principal exists in this workspace: users must hold an active membership,
 * groups must be this workspace's, roles must be built-in or this
 * workspace's custom roles.
 */
export async function validatePrincipals(
    companyId: bigint,
    grants: readonly GrantInput[]
): Promise<GrantInput[]> {
    const byKey = new Map<string, GrantInput>();
    for (const g of grants) {
        const principalId =
            g.principalType === "role" ? normalizeRoleSlug(g.principalId) : g.principalId.trim();
        if (g.principalType !== "role" && !/^\d{1,18}$/.test(principalId)) {
            throw badRequest(`Invalid ${g.principalType} id "${g.principalId}".`);
        }
        const next: GrantInput = { principalType: g.principalType, principalId, level: g.level };
        byKey.set(grantKey(next), next);
    }
    const desired = [...byKey.values()];

    const userIds = desired.filter(g => g.principalType === "user").map(g => BigInt(g.principalId));
    const groupIds = desired
        .filter(g => g.principalType === "group")
        .map(g => Number(g.principalId));
    const customSlugs = desired
        .filter(g => g.principalType === "role" && !isBuiltinRole(g.principalId))
        .map(g => g.principalId);

    const [memberRows, groupRows, roleRows] = await Promise.all([
        userIds.length === 0
            ? Promise.resolve([])
            : db
                  .select({ userId: userCompanyMemberships.userId })
                  .from(userCompanyMemberships)
                  .where(
                      and(
                          eq(userCompanyMemberships.companyId, companyId),
                          eq(userCompanyMemberships.status, "active"),
                          inArray(userCompanyMemberships.userId, userIds)
                      )
                  ),
        groupIds.length === 0
            ? Promise.resolve([])
            : db
                  .select({ id: workspaceGroups.id })
                  .from(workspaceGroups)
                  .where(
                      and(
                          eq(workspaceGroups.companyId, companyId),
                          inArray(workspaceGroups.id, groupIds)
                      )
                  ),
        customSlugs.length === 0
            ? Promise.resolve([])
            : db
                  .select({ slug: workspaceRoles.slug })
                  .from(workspaceRoles)
                  .where(
                      and(
                          eq(workspaceRoles.companyId, companyId),
                          inArray(workspaceRoles.slug, customSlugs)
                      )
                  ),
    ]);

    const knownUsers = new Set(memberRows.map(r => r.userId.toString()));
    const knownGroups = new Set(groupRows.map(r => String(r.id)));
    const knownRoles = new Set(roleRows.map(r => r.slug));
    for (const g of desired) {
        const known =
            g.principalType === "user"
                ? knownUsers.has(g.principalId)
                : g.principalType === "group"
                  ? knownGroups.has(g.principalId)
                  : isBuiltinRole(g.principalId) || knownRoles.has(g.principalId);
        if (!known) {
            throw badRequest(
                g.principalType === "user"
                    ? `User ${g.principalId} is not an active member of this workspace.`
                    : g.principalType === "group"
                      ? `Group ${g.principalId} does not exist in this workspace.`
                      : `Role "${g.principalId}" does not exist in this workspace.`
            );
        }
    }
    return desired;
}

/** `type:id` → display name for every principal in `grants`. */
export async function principalNames(
    companyId: bigint,
    grants: readonly PrincipalRef[]
): Promise<Map<string, string>> {
    const userIds = grants.filter(g => g.principalType === "user").map(g => Number(g.principalId));
    const groupIds = grants
        .filter(g => g.principalType === "group")
        .map(g => Number(g.principalId));

    const [userRows, groupRows, customNames] = await Promise.all([
        userIds.length === 0
            ? Promise.resolve([])
            : db
                  .select({ id: users.id, name: users.name })
                  .from(users)
                  .where(inArray(users.id, userIds)),
        groupIds.length === 0
            ? Promise.resolve([])
            : db
                  .select({ id: workspaceGroups.id, name: workspaceGroups.name })
                  .from(workspaceGroups)
                  .where(
                      and(
                          eq(workspaceGroups.companyId, companyId),
                          inArray(workspaceGroups.id, groupIds)
                      )
                  ),
        customRoleNames(companyId),
    ]);

    const names = new Map<string, string>();
    for (const u of userRows) names.set(`user:${u.id}`, u.name);
    for (const g of groupRows) names.set(`group:${g.id}`, g.name);
    for (const g of grants) {
        const key = grantKey(g);
        if (names.has(key)) continue;
        if (g.principalType === "role") {
            const slug = normalizeRoleSlug(g.principalId);
            names.set(key, roleLabel(slug, customNames.get(slug) ?? null));
        } else {
            names.set(key, g.principalType === "user" ? "Former member" : "Deleted group");
        }
    }
    return names;
}

export function toGrantViews(
    rows: readonly GrantRow[],
    names: ReadonlyMap<string, string>
): GrantView[] {
    const views: GrantView[] = [];
    for (const row of rows) {
        if (!isPrincipalType(row.principalType) || !isGrantLevel(row.level)) continue;
        views.push({
            id: row.id,
            principalType: row.principalType,
            principalId: row.principalId,
            principalName: names.get(grantKey(row)) ?? row.principalId,
            level: row.level,
        });
    }
    return views.sort(
        (a, b) =>
            PRINCIPAL_ORDER[a.principalType] - PRINCIPAL_ORDER[b.principalType] ||
            a.principalName.localeCompare(b.principalName)
    );
}

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

export interface GrantDiff {
    added: GrantInput[];
    changed: {
        id: number;
        principalType: string;
        principalId: string;
        from: string;
        to: GrantLevel;
    }[];
    removed: GrantRow[];
}

export function diffGrants(
    existing: readonly GrantRow[],
    desired: readonly GrantInput[]
): GrantDiff {
    const existingByKey = new Map(existing.map(e => [grantKey(e), e]));
    const desiredKeys = new Set(desired.map(grantKey));
    const diff: GrantDiff = { added: [], changed: [], removed: [] };
    for (const d of desired) {
        const current = existingByKey.get(grantKey(d));
        if (!current) diff.added.push(d);
        else if (current.level !== d.level) {
            diff.changed.push({
                id: current.id,
                principalType: d.principalType,
                principalId: d.principalId,
                from: current.level,
                to: d.level,
            });
        }
    }
    for (const e of existing) if (!desiredKeys.has(grantKey(e))) diff.removed.push(e);
    return diff;
}

// ---------------------------------------------------------------------------
// Who can see it
// ---------------------------------------------------------------------------

export interface Subject {
    userId: string;
    role: string;
    groupIds: ReadonlySet<string>;
}

export interface MemberPrincipal extends Subject {
    permissions: ReadonlySet<Permission>;
}

export function principalMatches(grant: PrincipalRef, subject: Subject): boolean {
    switch (grant.principalType) {
        case "user":
            return grant.principalId === subject.userId;
        case "group":
            return subject.groupIds.has(grant.principalId);
        case "role":
            return normalizeRoleSlug(grant.principalId) === subject.role;
        default:
            return false;
    }
}

/** Every active member with their permission set and group ids. */
export async function activeMemberPrincipals(companyId: bigint): Promise<MemberPrincipal[]> {
    const rows = await db
        .select({ userId: userCompanyMemberships.userId, role: userCompanyMemberships.role })
        .from(userCompanyMemberships)
        .where(
            and(
                eq(userCompanyMemberships.companyId, companyId),
                eq(userCompanyMemberships.status, "active")
            )
        );
    if (rows.length === 0) return [];

    const [permissions, groupRows] = await Promise.all([
        permissionsForRoles(
            companyId,
            rows.map(r => r.role)
        ),
        db
            .select({
                userId: workspaceGroupMembers.userId,
                groupId: workspaceGroupMembers.groupId,
            })
            .from(workspaceGroupMembers)
            .innerJoin(workspaceGroups, eq(workspaceGroups.id, workspaceGroupMembers.groupId))
            .where(eq(workspaceGroups.companyId, companyId)),
    ]);

    const groupsByUser = new Map<string, Set<string>>();
    for (const row of groupRows) {
        const key = row.userId.toString();
        const set = groupsByUser.get(key) ?? new Set<string>();
        set.add(row.groupId.toString());
        groupsByUser.set(key, set);
    }

    return rows.map(r => {
        const role = normalizeRoleSlug(r.role);
        const userId = r.userId.toString();
        return {
            userId,
            role,
            permissions: permissions.get(role) ?? new Set<Permission>(),
            groupIds: groupsByUser.get(userId) ?? new Set<string>(),
        };
    });
}

/** Same rules as `resolveDocumentScope`: managers see all, guests only what they were added to. */
export function canSeeFolder(
    member: MemberPrincipal,
    restricted: boolean,
    grants: readonly PrincipalRef[]
): boolean {
    if (!member.permissions.has("documents.read")) return false;
    const guest = member.role === "guest";
    if (!guest && member.permissions.has("folders.manage")) return true;
    if (!restricted) return !guest;
    return grants.some(g => principalMatches(g, member));
}

export function canSeeRestrictedDocument(
    member: MemberPrincipal,
    grants: readonly PrincipalRef[]
): boolean {
    if (!member.permissions.has("documents.read")) return false;
    if (member.role !== "guest" && member.permissions.has("folders.manage")) return true;
    return grants.some(g => principalMatches(g, member));
}

// ---------------------------------------------------------------------------
// The caller as a principal
// ---------------------------------------------------------------------------

export async function callerGroupIds(userPk: bigint): Promise<Set<string>> {
    const rows = await db
        .select({ groupId: workspaceGroupMembers.groupId })
        .from(workspaceGroupMembers)
        .where(eq(workspaceGroupMembers.userId, userPk));
    return new Set(rows.map(r => r.groupId.toString()));
}

export function callerSubject(ctx: WorkspaceContext, groupIds: ReadonlySet<string>): Subject {
    return { userId: ctx.userPk.toString(), role: ctx.role, groupIds };
}

/** True when one of `grants` gives the caller manage level, directly or via a group or their role. */
export function hasManageGrant(
    ctx: WorkspaceContext,
    groupIds: ReadonlySet<string>,
    grants: readonly (PrincipalRef & { level: string })[]
): boolean {
    const subject = callerSubject(ctx, groupIds);
    return grants.some(
        g =>
            isGrantLevel(g.level) &&
            grantLevelAtLeast(g.level, "manage") &&
            principalMatches(g, subject)
    );
}
