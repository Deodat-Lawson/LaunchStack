/**
 * The escalation rules, as pure functions so routes and tests share them.
 *
 * 1. A person may assign, or build into a custom role, only permissions they
 *    hold themselves; owner-only permissions are never assignable.
 * 2. Only an Owner may make or unmake an Owner. An Admin may make other
 *    Admins and anything below — a manager can add managers.
 * 3. The last Owner cannot be removed, suspended, or downgraded.
 * 4. Nobody changes their own role.
 */

import {
    OWNER_ONLY_PERMISSIONS,
    isSubset,
    normalizeRoleSlug,
    type Permission,
} from "./permissions";

export interface Actor {
    readonly userPk: bigint;
    readonly role: string;
    readonly permissions: ReadonlySet<Permission>;
}

export interface RoleTarget {
    readonly slug: string;
    readonly permissions: ReadonlySet<Permission>;
}

export function isOwner(role: string): boolean {
    return normalizeRoleSlug(role) === "owner";
}

export function isAdminTier(role: string): boolean {
    const slug = normalizeRoleSlug(role);
    return slug === "owner" || slug === "admin";
}

/** Rule 1 + 2: may `actor` hand out `target` (to someone else, or via a link/invitation)? */
export function canAssignRole(actor: Actor, target: RoleTarget): boolean {
    const slug = normalizeRoleSlug(target.slug);
    if (slug === "owner") return isOwner(actor.role);
    if (slug === "admin") return isAdminTier(actor.role);
    return isSubset(target.permissions, actor.permissions);
}

/** Rule 2: may `actor` change or remove a member who currently holds `targetRole`? */
export function canActOnMember(actor: Actor, targetRole: string, targetUserPk: bigint): boolean {
    if (targetUserPk === actor.userPk) return false;
    const slug = normalizeRoleSlug(targetRole);
    if (slug === "owner") return isOwner(actor.role);
    if (slug === "admin") return isAdminTier(actor.role);
    return true;
}

/** Rule 4. */
export function isSelf(actor: Actor, targetUserPk: bigint): boolean {
    return actor.userPk === targetUserPk;
}

/** Rule 3: would this change leave the workspace without an Owner? */
export function wouldRemoveLastOwner(input: {
    readonly targetIsOwner: boolean;
    readonly activeOwnerCount: number;
    /** True when the change keeps the target an active Owner (e.g. a rename). */
    readonly targetStaysOwner?: boolean;
}): boolean {
    if (!input.targetIsOwner) return false;
    if (input.targetStaysOwner) return false;
    return input.activeOwnerCount <= 1;
}

/** Rule 1 for custom roles: the permissions `actor` may put into a role. */
export function assignablePermissions(actor: Actor): Set<Permission> {
    const out = new Set<Permission>();
    for (const p of actor.permissions) if (!OWNER_ONLY_PERMISSIONS.has(p)) out.add(p);
    return out;
}

/** True when every permission in `requested` is one `actor` may assign. */
export function canGrantPermissions(actor: Actor, requested: ReadonlySet<Permission>): boolean {
    const allowed = assignablePermissions(actor);
    for (const p of requested) if (!allowed.has(p)) return false;
    return true;
}
