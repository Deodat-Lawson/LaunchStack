/**
 * Centralized auth + tenant resolution for API routes.
 *
 * Two helpers:
 *
 * - `requireWorkspaceContext()` — verified user + active company. Used by
 *   every product API route. Returns the full `WorkspaceContext` or a typed
 *   error response (401 / 403 / 500).
 *
 * - `requireClerkIdentity()` — session only, no DB. Used by signup /
 *   check-registration routes that operate before a user row exists.
 *
 * Callers use the same `{ success, data } | { success, response }` pattern
 * as `validateRequestBody` — no new convention to learn.
 */

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { eq, and } from "drizzle-orm";

import { db } from "~/server/db";
import { users, userCompanyMemberships } from "@launchstack/core/db/schema";
import { resolveActiveCompanyForUser } from "~/lib/active-workspace";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WorkspaceContext = {
  clerkUserId: string;
  userPk: bigint;
  companyId: bigint;
  role: string;
  status: string;
};

type WorkspaceSuccess = { success: true; data: WorkspaceContext };
type WorkspaceFailure = { success: false; response: NextResponse };
export type WorkspaceContextResult = WorkspaceSuccess | WorkspaceFailure;

type ClerkIdentity = { clerkUserId: string };
type IdentitySuccess = { success: true; data: ClerkIdentity };
type IdentityFailure = { success: false; response: NextResponse };
export type ClerkIdentityResult = IdentitySuccess | IdentityFailure;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function unauthorized(): WorkspaceFailure {
  return {
    success: false,
    response: NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 },
    ),
  };
}

function forbidden(): WorkspaceFailure {
  return {
    success: false,
    response: NextResponse.json(
      { error: "Forbidden" },
      { status: 403 },
    ),
  };
}

function internalError(): WorkspaceFailure {
  return {
    success: false,
    response: NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    ),
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
 * Only succeeds for **verified** users with a resolvable active company.
 */
export async function requireWorkspaceContext(): Promise<WorkspaceContextResult> {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) {
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
    .where(eq(users.userId, clerkUserId));

  if (!user) {
    return unauthorized();
  }

  if (user.status !== "verified") {
    return forbidden();
  }

  let companyId: bigint;
  try {
    companyId = await resolveActiveCompanyForUser(user.id, user.companyId);
  } catch {
    console.error(
      `[requireWorkspaceContext] Failed to resolve company for user ${clerkUserId}`,
    );
    return internalError();
  }

  if (companyId == null) {
    console.error(
      `[requireWorkspaceContext] Null company for user ${clerkUserId}`,
    );
    return internalError();
  }

  const userPk = BigInt(user.id);

  const [membership] = await db
    .select({ role: userCompanyMemberships.role })
    .from(userCompanyMemberships)
    .where(
      and(
        eq(userCompanyMemberships.userId, userPk),
        eq(userCompanyMemberships.companyId, companyId),
      ),
    );

  return {
    success: true,
    data: {
      clerkUserId,
      userPk,
      companyId,
      role: membership?.role ?? user.role,
      status: user.status,
    },
  };
}

// ---------------------------------------------------------------------------
// requireClerkIdentity
// ---------------------------------------------------------------------------

/**
 * Session-only check — no DB, no company resolution. Returns the Clerk
 * user id or 401. Used by signup / check-registration routes that operate
 * before a user row exists.
 */
export async function requireClerkIdentity(): Promise<ClerkIdentityResult> {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) {
    return {
      success: false,
      response: NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 },
      ),
    };
  }

  return {
    success: true,
    data: { clerkUserId },
  };
}
