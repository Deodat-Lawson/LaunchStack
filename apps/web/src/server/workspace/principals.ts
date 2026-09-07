/**
 * The principal picker's search: active members, groups, and roles of the
 * workspace, matched by a case-insensitive substring.
 */

import { and, asc, eq, ilike, or } from "drizzle-orm";

import { db } from "~/server/db";
import { userCompanyMemberships, users, workspaceGroups, workspaceRoles } from "~/server/db/schema";
import type { WorkspaceContext } from "~/lib/require-workspace-context";
import { BUILTIN_ROLES, roleLabel } from "~/lib/authz/permissions";

export interface PrincipalSearch {
    users: { id: number; name: string; email: string }[];
    groups: { id: number; name: string }[];
    roles: { slug: string; name: string }[];
}

const LIMIT = 20;

function likePattern(query: string): string {
    return `%${query.replace(/[\\%_]/g, m => `\\${m}`)}%`;
}

export async function searchPrincipals(ctx: WorkspaceContext, q: string): Promise<PrincipalSearch> {
    const query = q.trim().slice(0, 100);
    const pattern = query ? likePattern(query) : null;
    const lower = query.toLowerCase();

    const [userRows, groupRows, customRows] = await Promise.all([
        db
            .select({ id: users.id, name: users.name, email: users.email })
            .from(userCompanyMemberships)
            .innerJoin(users, eq(users.id, userCompanyMemberships.userId))
            .where(
                and(
                    eq(userCompanyMemberships.companyId, ctx.companyId),
                    eq(userCompanyMemberships.status, "active"),
                    pattern
                        ? or(ilike(users.name, pattern), ilike(users.email, pattern))
                        : undefined
                )
            )
            .orderBy(asc(users.name))
            .limit(LIMIT),
        db
            .select({ id: workspaceGroups.id, name: workspaceGroups.name })
            .from(workspaceGroups)
            .where(
                and(
                    eq(workspaceGroups.companyId, ctx.companyId),
                    pattern ? ilike(workspaceGroups.name, pattern) : undefined
                )
            )
            .orderBy(asc(workspaceGroups.name))
            .limit(LIMIT),
        db
            .select({ slug: workspaceRoles.slug, name: workspaceRoles.name })
            .from(workspaceRoles)
            .where(
                and(
                    eq(workspaceRoles.companyId, ctx.companyId),
                    pattern ? ilike(workspaceRoles.name, pattern) : undefined
                )
            )
            .orderBy(asc(workspaceRoles.name))
            .limit(LIMIT),
    ]);

    const builtins = BUILTIN_ROLES.map(slug => ({ slug, name: roleLabel(slug) })).filter(
        r => !lower || r.name.toLowerCase().includes(lower) || r.slug.includes(lower)
    );

    return {
        users: userRows.map(u => ({ id: Number(u.id), name: u.name, email: u.email })),
        groups: groupRows.map(g => ({ id: Number(g.id), name: g.name })),
        roles: [...builtins, ...customRows].slice(0, LIMIT),
    };
}
