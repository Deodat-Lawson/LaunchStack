/**
 * Centralized auth + tenant resolution for API routes.
 *
 * Three helpers:
 *
 * - `requireWorkspaceContext()` — verified user + active membership. Used by
 *   every product API route. Returns the full `WorkspaceContext` or a typed
 *   error response (401 / 403 / 500). The context answers two questions the
 *   rest of the request needs: `can(permission)` and `documentScope()`.
 *
 * - `requireWorkspacePermission(permission)` — the same, plus a 403 when the
 *   membership does not hold the permission.
 *
 * - `requireAuthIdentity()` — session only, no DB. Used by signup /
 *   check-registration routes that operate before a user row exists.
 *
 * Callers use the same `{ success, data } | { success, response }` pattern
 * as `validateRequestBody` — no new convention to learn.
 */

import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";

import { getServerSession } from "~/server/auth";

import { db } from "~/server/db";
import { users, userCompanyMemberships } from "~/server/db/schema";
import { resolveActiveCompanyForUser } from "~/lib/active-workspace";
import { resolvePermissionsForRole } from "~/lib/authz/resolve";
import { resolveDocumentScope } from "~/lib/authz/scope";
import {
    isMembershipStatus,
    normalizeRoleSlug,
    type MembershipStatus,
    type Permission,
} from "~/lib/authz/permissions";
import type { DocumentScope } from "~/lib/authz/scope-types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WorkspaceContext = {
    /** Opaque auth subject ID (better-auth user id; imported rows keep their Clerk-era strings). */
    authUserId: string;
    userPk: bigint;
    companyId: bigint;
    /** Membership role slug, normalised (`owner` | `admin` | `member` | `viewer` | `guest` | custom). */
    role: string;
    /** Membership status in the active workspace. Always `active` on a successful context. */
    status: MembershipStatus;
    permissions: ReadonlySet<Permission>;
    can(permission: Permission): boolean;
    /** Which documents this person may read. Lazy and memoised for the request. */
    documentScope(): Promise<DocumentScope>;
};

type WorkspaceSuccess = { success: true; data: WorkspaceContext };
type WorkspaceFailure = { success: false; response: NextResponse };
export type WorkspaceContextResult = WorkspaceSuccess | WorkspaceFailure;

type AuthIdentity = { authUserId: string };
type IdentitySuccess = { success: true; data: AuthIdentity };
type IdentityFailure = { success: false; response: NextResponse };
export type AuthIdentityResult = IdentitySuccess | IdentityFailure;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function unauthorized(): WorkspaceFailure {
    return {
        success: false,
        response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
}

function forbidden(message = "Forbidden"): WorkspaceFailure {
    return {
        success: false,
        response: NextResponse.json({ error: message }, { status: 403 }),
    };
}

function internalError(): WorkspaceFailure {
    return {
        success: false,
        response: NextResponse.json({ error: "Internal server error" }, { status: 500 }),
    };
}

/**
 * Builds the context object from resolved facts. Exported for tests and for
 * the handful of places (Server Components, scripts) that resolve a member
 * some other way and still want the same `can` / `documentScope` shape.
 */
export function buildWorkspaceContext(input: {
    authUserId: string;
    userPk: bigint;
    companyId: bigint;
    role: string;
    status: MembershipStatus;
    permissions: ReadonlySet<Permission>;
    resolveScope?: (subject: {
        companyId: bigint;
        userPk: bigint;
        role: string;
        permissions: ReadonlySet<Permission>;
    }) => Promise<DocumentScope>;
}): WorkspaceContext {
    const role = normalizeRoleSlug(input.role);
    const permissions = input.permissions;
    const resolve = input.resolveScope ?? resolveDocumentScope;
    let scopePromise: Promise<DocumentScope> | null = null;
    return {
        authUserId: input.authUserId,
        userPk: input.userPk,
        companyId: input.companyId,
        role,
        status: input.status,
        permissions,
        can: permission => permissions.has(permission),
        documentScope: () => {
            scopePromise ??= resolve({
                companyId: input.companyId,
                userPk: input.userPk,
                role,
                permissions,
            });
            return scopePromise;
        },
    };
}

// ---------------------------------------------------------------------------
// requireWorkspaceContext
// ---------------------------------------------------------------------------

/**
 * Resolve a signed-in user's identity, active company, role, and permission
 * set — or return an error response. Every product API route should call
 * this once at the top of its handler.
 *
 * Only succeeds for users who hold an **active** membership in the resolved
 * company. The role always comes from that membership; the legacy global
 * `users.role` is never consulted.
 */
export async function requireWorkspaceContext(): Promise<WorkspaceContextResult> {
    const session = await getServerSession();
    const authUserId = session?.user.id;
    if (!authUserId) {
        return unauthorized();
    }

    const [user] = await db
        .select({
            id: users.id,
            companyId: users.companyId,
        })
        .from(users)
        .where(eq(users.userId, authUserId));

    if (!user) {
        return unauthorized();
    }

    let companyId: bigint | null;
    try {
        companyId = await resolveActiveCompanyForUser(user.id, user.companyId);
    } catch {
        console.error(`[requireWorkspaceContext] Failed to resolve company for user ${authUserId}`);
        return internalError();
    }

    if (companyId == null) {
        console.error(`[requireWorkspaceContext] Null company for user ${authUserId}`);
        return forbidden();
    }

    const userPk = BigInt(user.id);

    const [membership] = await db
        .select({ role: userCompanyMemberships.role, status: userCompanyMemberships.status })
        .from(userCompanyMemberships)
        .where(
            and(
                eq(userCompanyMemberships.userId, userPk),
                eq(userCompanyMemberships.companyId, companyId)
            )
        );

    // No membership means no workspace, even when the company came from
    // `users.companyId`. Falling back to the legacy global `users.role` here
    // would turn a membership miss into a working context with a role nobody
    // granted for this tenant.
    if (!membership) {
        return forbidden();
    }

    const status: MembershipStatus = isMembershipStatus(membership.status)
        ? membership.status
        : "active";
    if (status !== "active") {
        return forbidden();
    }

    let permissions: ReadonlySet<Permission>;
    try {
        permissions = await resolvePermissionsForRole(companyId, membership.role);
    } catch (error) {
        console.error(
            `[requireWorkspaceContext] Failed to resolve role for user ${authUserId}`,
            error
        );
        return internalError();
    }

    return {
        success: true,
        data: buildWorkspaceContext({
            authUserId,
            userPk,
            companyId,
            role: membership.role,
            status,
            permissions,
        }),
    };
}

// ---------------------------------------------------------------------------
// Permission gates
// ---------------------------------------------------------------------------

/** 403 response for a caller whose membership lacks a permission. */
export function forbiddenForPermission(permission?: Permission): NextResponse {
    return NextResponse.json(
        {
            error: "Forbidden",
            ...(permission ? { permission } : {}),
        },
        { status: 403 }
    );
}

/** @deprecated Use `forbiddenForPermission`. Kept for callers migrated in bulk. */
export function forbiddenForRole(): NextResponse {
    return forbiddenForPermission();
}

/**
 * `requireWorkspaceContext()` plus one permission check. The common shape of
 * a route that mutates workspace-wide state:
 *
 *   const ctx = await requireWorkspacePermission("documents.delete");
 *   if (!ctx.success) return ctx.response;
 */
export async function requireWorkspacePermission(
    permission: Permission
): Promise<WorkspaceContextResult> {
    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx;
    if (!ctx.data.can(permission)) {
        return { success: false, response: forbiddenForPermission(permission) };
    }
    return ctx;
}

// ---------------------------------------------------------------------------
// requireAuthIdentity
// ---------------------------------------------------------------------------

/**
 * Session-only check — no DB beyond the session lookup, no company
 * resolution. Returns the auth subject id or 401. Used by signup /
 * check-registration routes that operate before a user row exists.
 */
export async function requireAuthIdentity(): Promise<AuthIdentityResult> {
    const session = await getServerSession();
    const authUserId = session?.user.id;
    if (!authUserId) {
        return {
            success: false,
            response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
        };
    }

    return {
        success: true,
        data: { authUserId },
    };
}
