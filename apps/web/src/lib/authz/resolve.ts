/**
 * Membership role slug → permission set.
 *
 * Built-in slugs resolve from the catalogue without touching the database.
 * Anything else is a `workspace_roles` row looked up by (company, slug); an
 * unknown slug resolves to no permissions at all — fail closed, never open.
 */

import { and, eq } from "drizzle-orm";

import { db } from "~/server/db";
import { workspaceRoles } from "~/server/db/schema";

import {
    builtinRolePermissions,
    normalizeRoleSlug,
    permissionsFromList,
    type Permission,
} from "./permissions";

export interface ResolvedRole {
    /** The slug as stored, normalised for legacy aliases. */
    slug: string;
    /** Display name — the catalogue label for built-ins, the row's name for custom roles. */
    name: string | null;
    permissions: ReadonlySet<Permission>;
    custom: boolean;
}

export async function resolveRole(companyId: bigint, roleSlug: string): Promise<ResolvedRole> {
    const slug = normalizeRoleSlug(roleSlug);
    const builtin = builtinRolePermissions(slug);
    if (builtin) {
        return { slug, name: null, permissions: builtin, custom: false };
    }

    const [row] = await db
        .select({ name: workspaceRoles.name, permissions: workspaceRoles.permissions })
        .from(workspaceRoles)
        .where(and(eq(workspaceRoles.companyId, companyId), eq(workspaceRoles.slug, slug)))
        .limit(1);

    if (!row) {
        return { slug, name: null, permissions: new Set<Permission>(), custom: true };
    }

    return {
        slug,
        name: row.name,
        permissions: permissionsFromList(row.permissions ?? []),
        custom: true,
    };
}

export async function resolvePermissionsForRole(
    companyId: bigint,
    roleSlug: string
): Promise<ReadonlySet<Permission>> {
    return (await resolveRole(companyId, roleSlug)).permissions;
}
