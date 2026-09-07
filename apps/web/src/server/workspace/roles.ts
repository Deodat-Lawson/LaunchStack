/**
 * Roles: the five built-ins from the catalogue plus a workspace's custom
 * `workspace_roles` rows. Custom roles are referenced by slug from
 * memberships, invitations, join links, and role-principal grants, so the
 * slug never changes after creation — a rename changes only the name.
 */

import { and, eq, inArray } from "drizzle-orm";

import { db } from "~/server/db";
import { userCompanyMemberships, workspaceRoles } from "~/server/db/schema";
import type { WorkspaceContext } from "~/lib/require-workspace-context";
import { recordAuditEvent } from "~/lib/authz/audit";
import { canAssignRole, canGrantPermissions } from "~/lib/authz/escalation";
import {
    BUILTIN_ROLES,
    BUILTIN_ROLE_PERMISSIONS,
    LEGACY_ROLE_ALIASES,
    OWNER_ONLY_PERMISSIONS,
    PERMISSIONS,
    PERMISSION_DESCRIPTIONS,
    ROLE_DESCRIPTIONS,
    isBuiltinRole,
    normalizeRoleSlug,
    permissionsFromList,
    roleLabel,
    roleRank,
    type Permission,
} from "~/lib/authz/permissions";
import { resolveRole, type ResolvedRole } from "~/lib/authz/resolve";
import { slugifyName } from "~/lib/workspace-slug";

import { badRequest, conflict, forbidden, notFound } from "./errors";

export interface RoleView {
    id: number | null;
    slug: string;
    name: string;
    description: string | null;
    permissions: string[];
    builtin: boolean;
    memberCount: number;
    assignable: boolean;
    editable: boolean;
}

export interface PermissionView {
    key: Permission;
    description: string;
    ownerOnly: boolean;
}

// ---------------------------------------------------------------------------
// Shared lookups
// ---------------------------------------------------------------------------

/** slug → display name for this workspace's custom roles. */
export async function customRoleNames(companyId: bigint): Promise<Map<string, string>> {
    const rows = await db
        .select({ slug: workspaceRoles.slug, name: workspaceRoles.name })
        .from(workspaceRoles)
        .where(eq(workspaceRoles.companyId, companyId));
    return new Map(rows.map(r => [r.slug, r.name]));
}

export function displayRoleName(slug: string, customNames: ReadonlyMap<string, string>): string {
    const normalized = normalizeRoleSlug(slug);
    return roleLabel(normalized, customNames.get(normalized) ?? null);
}

/**
 * The role a slug names in this workspace, or a 400 when nothing does. A
 * custom row always carries a name, so `custom && name === null` is exactly
 * "no such role".
 */
export async function requireKnownRole(companyId: bigint, slug: string): Promise<ResolvedRole> {
    const resolved = await resolveRole(companyId, slug);
    if (resolved.custom && resolved.name === null) {
        throw badRequest(`Unknown role "${slug}".`);
    }
    return resolved;
}

/**
 * A role the caller may hand to someone else. Owner is never handed out
 * through this path — ownership moves only via transfer.
 */
export async function requireAssignableRole(
    ctx: WorkspaceContext,
    slug: string
): Promise<ResolvedRole> {
    const resolved = await requireKnownRole(ctx.companyId, slug);
    if (resolved.slug === "owner") {
        throw badRequest("Ownership is transferred, never assigned.");
    }
    if (!canAssignRole(ctx, resolved)) {
        throw forbidden(`You cannot assign the ${roleLabel(resolved.slug, resolved.name)} role.`);
    }
    return resolved;
}

/** slug → permission set for every role that appears in `slugs`. */
export async function permissionsForRoles(
    companyId: bigint,
    slugs: Iterable<string>
): Promise<Map<string, ReadonlySet<Permission>>> {
    const out = new Map<string, ReadonlySet<Permission>>();
    const customSlugs: string[] = [];
    for (const raw of slugs) {
        const slug = normalizeRoleSlug(raw);
        if (out.has(slug)) continue;
        if (isBuiltinRole(slug)) {
            out.set(slug, BUILTIN_ROLE_PERMISSIONS[slug]);
        } else {
            out.set(slug, new Set<Permission>());
            customSlugs.push(slug);
        }
    }
    if (customSlugs.length > 0) {
        const rows = await db
            .select({ slug: workspaceRoles.slug, permissions: workspaceRoles.permissions })
            .from(workspaceRoles)
            .where(
                and(
                    eq(workspaceRoles.companyId, companyId),
                    inArray(workspaceRoles.slug, customSlugs)
                )
            );
        for (const row of rows) out.set(row.slug, permissionsFromList(row.permissions ?? []));
    }
    return out;
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

export function permissionCatalogue(): PermissionView[] {
    return PERMISSIONS.map(key => ({
        key,
        description: PERMISSION_DESCRIPTIONS[key],
        ownerOnly: OWNER_ONLY_PERMISSIONS.has(key),
    }));
}

async function membershipCountsByRole(companyId: bigint): Promise<Map<string, number>> {
    const rows = await db
        .select({ role: userCompanyMemberships.role })
        .from(userCompanyMemberships)
        .where(eq(userCompanyMemberships.companyId, companyId));
    const counts = new Map<string, number>();
    for (const row of rows) {
        const slug = normalizeRoleSlug(row.role);
        counts.set(slug, (counts.get(slug) ?? 0) + 1);
    }
    return counts;
}

function toRoleView(
    ctx: WorkspaceContext,
    role: {
        id: number | null;
        slug: string;
        name: string;
        description: string | null;
        permissions: ReadonlySet<Permission>;
        builtin: boolean;
    },
    memberCount: number
): RoleView {
    return {
        id: role.id,
        slug: role.slug,
        name: role.name,
        description: role.description,
        permissions: [...role.permissions],
        builtin: role.builtin,
        memberCount,
        assignable: canAssignRole(ctx, { slug: role.slug, permissions: role.permissions }),
        editable:
            !role.builtin && ctx.can("roles.manage") && canGrantPermissions(ctx, role.permissions),
    };
}

export async function listRoles(
    ctx: WorkspaceContext
): Promise<{ roles: RoleView[]; permissions: PermissionView[] }> {
    const [customRows, counts] = await Promise.all([
        db.select().from(workspaceRoles).where(eq(workspaceRoles.companyId, ctx.companyId)),
        membershipCountsByRole(ctx.companyId),
    ]);

    const builtins = [...BUILTIN_ROLES]
        .sort((a, b) => roleRank(b) - roleRank(a))
        .map(slug =>
            toRoleView(
                ctx,
                {
                    id: null,
                    slug,
                    name: roleLabel(slug),
                    description: ROLE_DESCRIPTIONS[slug],
                    permissions: BUILTIN_ROLE_PERMISSIONS[slug],
                    builtin: true,
                },
                counts.get(slug) ?? 0
            )
        );

    const custom = customRows
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(row =>
            toRoleView(
                ctx,
                {
                    id: row.id,
                    slug: row.slug,
                    name: row.name,
                    description: row.description,
                    permissions: permissionsFromList(row.permissions ?? []),
                    builtin: false,
                },
                counts.get(row.slug) ?? 0
            )
        );

    return { roles: [...builtins, ...custom], permissions: permissionCatalogue() };
}

async function getRoleView(ctx: WorkspaceContext, id: number): Promise<RoleView> {
    const [row] = await db
        .select()
        .from(workspaceRoles)
        .where(and(eq(workspaceRoles.companyId, ctx.companyId), eq(workspaceRoles.id, id)))
        .limit(1);
    if (!row) throw notFound("Role not found.");
    const counts = await membershipCountsByRole(ctx.companyId);
    return toRoleView(
        ctx,
        {
            id: row.id,
            slug: row.slug,
            name: row.name,
            description: row.description,
            permissions: permissionsFromList(row.permissions ?? []),
            builtin: false,
        },
        counts.get(row.slug) ?? 0
    );
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

function requestedPermissions(ctx: WorkspaceContext, list: readonly string[]): Set<Permission> {
    const set = permissionsFromList(list);
    if (set.size !== new Set(list).size) {
        throw badRequest("One or more permissions are not in the catalogue.");
    }
    if (!canGrantPermissions(ctx, set)) {
        throw forbidden("A role may only hold permissions you hold yourself.");
    }
    return set;
}

function roleSlugFromName(name: string): string {
    const slug = slugifyName(name).slice(0, 64).replace(/-+$/, "");
    if (!slug || slug === "workspace") throw badRequest("Choose a name with letters or numbers.");
    if (isBuiltinRole(slug) || slug in LEGACY_ROLE_ALIASES) {
        throw badRequest(`"${name}" is a built-in role name.`);
    }
    return slug;
}

export async function createRole(
    ctx: WorkspaceContext,
    input: { name: string; description?: string | null; permissions: string[] }
): Promise<RoleView> {
    const slug = roleSlugFromName(input.name);
    const permissions = requestedPermissions(ctx, input.permissions);

    const [existing] = await db
        .select({ id: workspaceRoles.id })
        .from(workspaceRoles)
        .where(and(eq(workspaceRoles.companyId, ctx.companyId), eq(workspaceRoles.slug, slug)))
        .limit(1);
    if (existing) throw conflict("A role with that name already exists.");

    const id = await db.transaction(async tx => {
        const [row] = await tx
            .insert(workspaceRoles)
            .values({
                companyId: ctx.companyId,
                slug,
                name: input.name,
                description: input.description ?? null,
                permissions: [...permissions],
                createdBy: ctx.authUserId,
            })
            .returning({ id: workspaceRoles.id });
        if (!row) throw new Error("Role insert returned no row");
        await recordAuditEvent(tx, {
            companyId: ctx.companyId,
            actorUserId: ctx.authUserId,
            action: "role.created",
            targetType: "role",
            targetId: slug,
            detail: { name: input.name, permissions: [...permissions] },
        });
        return row.id;
    });

    return getRoleView(ctx, id);
}

export async function updateRole(
    ctx: WorkspaceContext,
    id: number,
    input: { name?: string; description?: string | null; permissions?: string[] }
): Promise<RoleView> {
    const [row] = await db
        .select()
        .from(workspaceRoles)
        .where(and(eq(workspaceRoles.companyId, ctx.companyId), eq(workspaceRoles.id, id)))
        .limit(1);
    if (!row) throw notFound("Role not found.");

    const current = permissionsFromList(row.permissions ?? []);
    if (!canGrantPermissions(ctx, current)) {
        throw forbidden("This role holds permissions you do not have.");
    }
    const next = input.permissions ? requestedPermissions(ctx, input.permissions) : current;

    const added = [...next].filter(p => !current.has(p));
    const removed = [...current].filter(p => !next.has(p));

    await db.transaction(async tx => {
        await tx
            .update(workspaceRoles)
            .set({
                ...(input.name !== undefined ? { name: input.name } : {}),
                ...(input.description !== undefined ? { description: input.description } : {}),
                ...(input.permissions ? { permissions: [...next] } : {}),
            })
            .where(eq(workspaceRoles.id, id));
        await recordAuditEvent(tx, {
            companyId: ctx.companyId,
            actorUserId: ctx.authUserId,
            action: "role.updated",
            targetType: "role",
            targetId: row.slug,
            detail: {
                added,
                removed,
                ...(input.name !== undefined && input.name !== row.name
                    ? { renamed: { from: row.name, to: input.name } }
                    : {}),
            },
        });
    });

    return getRoleView(ctx, id);
}

export async function deleteRole(
    ctx: WorkspaceContext,
    id: number,
    reassignTo?: string
): Promise<{ success: true; reassigned: number }> {
    const [row] = await db
        .select()
        .from(workspaceRoles)
        .where(and(eq(workspaceRoles.companyId, ctx.companyId), eq(workspaceRoles.id, id)))
        .limit(1);
    if (!row) throw notFound("Role not found.");

    const holders = await db
        .select({ id: userCompanyMemberships.id, userId: userCompanyMemberships.userId })
        .from(userCompanyMemberships)
        .where(
            and(
                eq(userCompanyMemberships.companyId, ctx.companyId),
                eq(userCompanyMemberships.role, row.slug)
            )
        );

    let target: ResolvedRole | null = null;
    if (holders.length > 0) {
        if (!reassignTo) {
            throw conflict(
                `${holders.length} member${holders.length === 1 ? "" : "s"} still hold this role. Choose a role to move them to.`,
                { memberCount: holders.length }
            );
        }
        target = await requireAssignableRole(ctx, reassignTo);
        if (target.slug === row.slug)
            throw badRequest("Choose a different role to move members to.");
    }

    await db.transaction(async tx => {
        if (target) {
            for (const holder of holders) {
                await tx
                    .update(userCompanyMemberships)
                    .set({ role: target.slug })
                    .where(eq(userCompanyMemberships.id, holder.id));
                await recordAuditEvent(tx, {
                    companyId: ctx.companyId,
                    actorUserId: ctx.authUserId,
                    action: "member.role_changed",
                    targetType: "member",
                    targetId: holder.userId,
                    detail: { from: row.slug, to: target.slug, reason: "role.deleted" },
                });
            }
        }
        await tx.delete(workspaceRoles).where(eq(workspaceRoles.id, id));
        await recordAuditEvent(tx, {
            companyId: ctx.companyId,
            actorUserId: ctx.authUserId,
            action: "role.deleted",
            targetType: "role",
            targetId: row.slug,
            detail: {
                name: row.name,
                reassigned: holders.length,
                ...(target ? { reassignedTo: target.slug } : {}),
            },
        });
    });

    return { success: true, reassigned: holders.length };
}
