/**
 * Builds a `WorkspaceContext` for route tests.
 *
 * Tests used to spell the context out as a five-field literal. The context
 * now carries the resolved permission set plus `can()` and `documentScope()`,
 * so a literal would have to reimplement both; this helper derives them from
 * a role (or an explicit permission list) and a scope, and nothing else.
 */

import type { WorkspaceContext } from "~/lib/require-workspace-context";
import {
    builtinRolePermissions,
    normalizeRoleSlug,
    type MembershipStatus,
    type Permission,
} from "~/lib/authz/permissions";
import { SCOPE_EVERYTHING, type DocumentScope } from "~/lib/authz/scope-types";

export interface WorkspaceContextOverrides {
    authUserId?: string;
    userPk?: bigint;
    companyId?: bigint;
    role?: string;
    status?: MembershipStatus;
    /** Replaces the role-derived set entirely when given. */
    permissions?: Iterable<Permission>;
    scope?: DocumentScope;
}

export function makeWorkspaceContext(overrides: WorkspaceContextOverrides = {}): WorkspaceContext {
    const role = normalizeRoleSlug(overrides.role ?? "owner");
    const permissions: ReadonlySet<Permission> = overrides.permissions
        ? new Set(overrides.permissions)
        : (builtinRolePermissions(role) ?? new Set<Permission>());
    const scope = overrides.scope ?? SCOPE_EVERYTHING;
    return {
        authUserId: overrides.authUserId ?? "user-a",
        userPk: overrides.userPk ?? BigInt(7),
        companyId: overrides.companyId ?? BigInt(5),
        role,
        status: overrides.status ?? "active",
        permissions,
        can: permission => permissions.has(permission),
        documentScope: () => Promise.resolve(scope),
    };
}
