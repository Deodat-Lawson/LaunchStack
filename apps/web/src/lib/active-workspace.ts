/**
 * Active workspace selection.
 *
 * A user can belong to multiple companies via `userCompanyMemberships`. Per
 * request we resolve the active workspace from a signed cookie, falling back
 * to `users.companyId` (the user's "default" workspace) when the cookie is
 * missing or points at a workspace the user is no longer a member of.
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
import { users, userCompanyMemberships } from "@launchstack/core/db/schema";

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
 * Resolve the active companyId for a Clerk user. Always returns the user's
 * default workspace when the cookie is missing or stale, never throws on a
 * missing membership — this is the load-bearing scoping check, so it has to
 * always return something safe.
 */
export async function getActiveCompanyId(
    clerkUserId: string
): Promise<bigint> {
    const [user] = await db
        .select({ id: users.id, companyId: users.companyId })
        .from(users)
        .where(eq(users.userId, clerkUserId));

    if (!user) {
        throw new Error("User not found in database");
    }

    return resolveActiveCompanyForUser(BigInt(user.id), user.companyId);
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
    defaultCompanyId: number | bigint
): Promise<bigint> {
    const userPkBig = typeof userPk === "bigint" ? userPk : BigInt(userPk);
    const defaultBig =
        typeof defaultCompanyId === "bigint"
            ? defaultCompanyId
            : BigInt(defaultCompanyId);

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

    return defaultBig;
}

/**
 * Same as getActiveCompanyId but also returns the role for the active
 * workspace. Used by routes that gate writes on workspace role.
 */
export async function getActiveCompanyContext(
    clerkUserId: string
): Promise<{ companyId: bigint; role: string; userId: bigint }> {
    const companyId = await getActiveCompanyId(clerkUserId);
    const [user] = await db
        .select({ id: users.id, role: users.role })
        .from(users)
        .where(eq(users.userId, clerkUserId));

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

    return {
        companyId,
        role: membership?.role ?? user.role,
        userId: userPkBig,
    };
}

/**
 * Set the active workspace cookie on a NextResponse. Caller must verify
 * membership before calling this.
 */
export function setActiveWorkspaceCookie(
    response: NextResponse,
    companyId: bigint
): void {
    response.cookies.set(
        ACTIVE_WORKSPACE_COOKIE,
        companyId.toString(),
        cookieOptions()
    );
}

/**
 * Imperatively set the active workspace cookie via next/headers. Use from
 * Server Actions; in route handlers prefer setActiveWorkspaceCookie on the
 * NextResponse so the cookie ships with that exact response.
 */
export async function writeActiveWorkspaceCookie(
    companyId: bigint
): Promise<void> {
    const cookieStore = await cookies();
    cookieStore.set(
        ACTIVE_WORKSPACE_COOKIE,
        companyId.toString(),
        cookieOptions()
    );
}
