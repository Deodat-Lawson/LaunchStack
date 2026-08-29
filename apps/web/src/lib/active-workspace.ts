/**
 * Active workspace selection.
 *
 * A user can belong to multiple companies via `userCompanyMemberships`. Per
 * request we resolve the active workspace from a signed cookie. Pending
 * accounts may fall back to `users.companyId` before membership provisioning;
 * verified accounts may use that pointer only when a live membership exists.
 *
 * Server code that previously did:
 *
 *   const [u] = await db.select().from(users).where(eq(users.userId, clerkId));
 *   const companyId = u.companyId;
 *
 * should now do:
 *
 *   const companyId = await getActiveCompanyId(clerkId);
 */

import { cookies } from "next/headers";
import { eq, and } from "drizzle-orm";
import type { NextResponse } from "next/server";

import { db } from "~/server/db";
import { users, userCompanyMemberships } from "~/server/db/schema";

export const ACTIVE_WORKSPACE_COOKIE = "pdr_active_company";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

type CookieOptions = {
    httpOnly: boolean;
    sameSite: "lax";
    secure: boolean;
    path: string;
    maxAge: number;
};

const cookieOptions = (): CookieOptions => ({
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
});

const parseCompanyId = (raw: string | undefined): bigint | null => {
    if (!raw) return null;
    try {
        const n = BigInt(raw);
        return n > 0n ? n : null;
    } catch {
        return null;
    }
};

/**
 * Resolve the active companyId for a Clerk user. Pending accounts may use the
 * legacy default without membership; verified accounts receive null unless
 * the cookie or default points to a current membership.
 */
export async function getActiveCompanyId(authUserId: string): Promise<bigint | null> {
    const [user] = await db
        .select({ id: users.id, companyId: users.companyId, status: users.status })
        .from(users)
        .where(eq(users.userId, authUserId));

    if (!user) {
        throw new Error("User not found in database");
    }

    return resolveActiveCompanyForUser(BigInt(user.id), user.companyId, user.status);
}

/**
 * Resolve active companyId given a user we already have in scope. Saves the
 * extra SELECT against `users` when callers fetch their own user row.
 *
 * Accepts `number | bigint` for both args since `users.id` is `serial`
 * (number) but the memberships FK is `bigint` mode — we coerce on entry.
 */
export async function resolveActiveCompanyForUser(
    userPk: number | bigint,
    defaultCompanyId: number | bigint,
    status: string
): Promise<bigint | null> {
    const userPkBig = typeof userPk === "bigint" ? userPk : BigInt(userPk);
    const defaultBig =
        typeof defaultCompanyId === "bigint" ? defaultCompanyId : BigInt(defaultCompanyId);

    const cookieStore = await cookies();
    const cookieValue = cookieStore.get(ACTIVE_WORKSPACE_COOKIE)?.value;
    const cookieCompanyId = parseCompanyId(cookieValue);

    if (cookieCompanyId !== null && cookieCompanyId !== defaultBig) {
        const [membership] = await db
            .select({ companyId: userCompanyMemberships.companyId })
            .from(userCompanyMemberships)
            .where(
                and(
                    eq(userCompanyMemberships.userId, userPkBig),
                    eq(userCompanyMemberships.companyId, cookieCompanyId)
                )
            );
        if (membership) {
            return cookieCompanyId;
        }
        // cookie points at a workspace the user no longer belongs to; fall through
    }

    if (status === "pending") {
        return defaultBig;
    }

    const [defaultMembership] = await db
        .select({ companyId: userCompanyMemberships.companyId })
        .from(userCompanyMemberships)
        .where(
            and(
                eq(userCompanyMemberships.userId, userPkBig),
                eq(userCompanyMemberships.companyId, defaultBig)
            )
        );

    return defaultMembership?.companyId ?? null;
}

/**
 * Same as getActiveCompanyId but also returns the role for the active
 * workspace. Used by routes that gate writes on workspace role.
 *
 * Throws when the user holds no membership in the resolved company — the
 * legacy `users.role` is a global column and says nothing about what the
 * user may do inside this tenant.
 */
export async function getActiveCompanyContext(
    authUserId: string
): Promise<{ companyId: bigint; role: string; userId: bigint }> {
    const companyId = await getActiveCompanyId(authUserId);
    if (companyId === null) {
        throw new Error(`User ${authUserId} has no active workspace`);
    }
    const [user] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.userId, authUserId));

    if (!user) throw new Error("User not found");

    const userPkBig = BigInt(user.id);
    const [membership] = await db
        .select({ role: userCompanyMemberships.role })
        .from(userCompanyMemberships)
        .where(
            and(
                eq(userCompanyMemberships.userId, userPkBig),
                eq(userCompanyMemberships.companyId, companyId)
            )
        );

    if (!membership) {
        throw new Error(`User ${authUserId} has no membership in company ${companyId}`);
    }

    return {
        companyId,
        role: membership.role,
        userId: userPkBig,
    };
}

/**
 * Set the active workspace cookie on a NextResponse. Caller must verify
 * membership before calling this.
 */
export function setActiveWorkspaceCookie(response: NextResponse, companyId: bigint): void {
    response.cookies.set(ACTIVE_WORKSPACE_COOKIE, companyId.toString(), cookieOptions());
}

/**
 * Imperatively set the active workspace cookie via next/headers. Use from
 * Server Actions; in route handlers prefer setActiveWorkspaceCookie on the
 * NextResponse so the cookie ships with that exact response.
 */
export async function writeActiveWorkspaceCookie(companyId: bigint): Promise<void> {
    const cookieStore = await cookies();
    cookieStore.set(ACTIVE_WORKSPACE_COOKIE, companyId.toString(), cookieOptions());
}
