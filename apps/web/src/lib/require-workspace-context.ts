/**
 * Centralized auth + tenant resolution for API routes.
 *
 * Two helpers:
 *
 * - `requireWorkspaceContext()` — verified user + active company. Used by
 *   every product API route. Returns the full `WorkspaceContext` or a typed
 *   error response (401 / 403 / 500).
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WorkspaceContext = {
    /** Opaque auth subject ID (better-auth user id; imported rows keep their Clerk-era strings). */
    authUserId: string;
    userPk: bigint;
    companyId: bigint;
    role: string;
    status: string;
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

function forbidden(): WorkspaceFailure {
    return {
        success: false,
        response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
}

function internalError(): WorkspaceFailure {
    return {
        success: false,
        response: NextResponse.json({ error: "Internal server error" }, { status: 500 }),
    };
}

// ---------------------------------------------------------------------------
// requireWorkspaceContext
// ---------------------------------------------------------------------------

/**
 * Resolve a verified user's identity, active company, and role — or return
 * an error response. Every product API route should call this once at the
 * top of its handler.
 *
 * Only succeeds for **verified** users who hold a membership in the
 * resolved company. The role always comes from that membership.
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
            role: users.role,
            status: users.status,
        })
        .from(users)
        .where(eq(users.userId, authUserId));

    if (!user) {
        return unauthorized();
    }

    if (user.status !== "verified") {
        return forbidden();
    }

    let companyId: bigint | null;
    try {
        companyId = await resolveActiveCompanyForUser(user.id, user.companyId, user.status);
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
        .select({ role: userCompanyMemberships.role })
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

    return {
        success: true,
        data: {
            authUserId,
            userPk,
            companyId,
            role: membership.role,
            status: user.status,
        },
    };
}

// ---------------------------------------------------------------------------
// Role gates
// ---------------------------------------------------------------------------

export { MANAGEMENT_ROLES, isManagementRole } from "~/lib/membership-roles";

/**
 * 403 response for a caller whose membership role is too low. Returned by
 * handlers that mutate workspace-wide state.
 */
export function forbiddenForRole(): NextResponse {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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
