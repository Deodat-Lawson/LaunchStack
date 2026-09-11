/**
 * The Better Auth instance — sessions, credentials, and the /api/auth/*
 * surface. Replaces Clerk; see docs/design: Better Auth migration.
 *
 * Two deliberate choices:
 *
 * - Its own postgres.js client rather than the engine's. Middleware imports
 *   this module to read sessions, and the engine barrel would drag the whole
 *   LLM/storage dependency graph into the middleware bundle. Same pattern as
 *   the role-routing client middleware already owns.
 *
 * - Lazily built behind a Proxy (the ~/server/db pattern), so importing this
 *   module costs nothing until the first auth call. Tests that mock callers
 *   never construct it, and SKIP_ENV_VALIDATION imports stay inert.
 *
 * Password verification accepts two hash formats: better-auth's scrypt for
 * accounts created here, and bcrypt ($2a$/$2b$) for accounts imported from
 * Clerk (scripts/import-clerk-users.ts). New and changed passwords are
 * always stored as scrypt.
 */
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import { nextCookies } from "better-auth/next-js";
import bcrypt from "bcryptjs";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { authAccount, authSession, authUser, authVerification } from "~/server/db/schema/auth";
import { sendAuthEmail } from "./email";

// process.env directly, not ~/env — the same trade the middleware's own DB
// client makes. This module sits in the middleware bundle, and ~/env drags
// dotenv + import.meta resolution in with it; the variables read here are
// still declared and validated in env.ts via the app's other import paths.
const buildAuth = () => {
    const client = postgres(process.env.DATABASE_URL!, { max: 5 });
    const db = drizzle(client, {
        schema: { authUser, authSession, authAccount, authVerification },
    });

    const google = process.env.AUTH_GOOGLE_CLIENT_ID && process.env.AUTH_GOOGLE_CLIENT_SECRET;
    const github = process.env.AUTH_GITHUB_CLIENT_ID && process.env.AUTH_GITHUB_CLIENT_SECRET;

    return betterAuth({
        secret: process.env.BETTER_AUTH_SECRET,
        baseURL: process.env.BETTER_AUTH_URL,
        database: drizzleAdapter(db, {
            provider: "pg",
            schema: {
                user: authUser,
                session: authSession,
                account: authAccount,
                verification: authVerification,
            },
        }),
        emailAndPassword: {
            enabled: true,
            sendResetPassword: async ({ user, url }) => {
                await sendAuthEmail({
                    to: user.email,
                    subject: "Reset your LaunchStack password",
                    text:
                        `Someone asked to reset the password for ${user.email}. ` +
                        `Open this link to choose a new one:\n\n${url}\n\n` +
                        `If that wasn't you, ignore this email — nothing changes.`,
                });
            },
            password: {
                hash: password => hashPassword(password),
                verify: async ({ hash, password }) =>
                    hash.startsWith("$2")
                        ? bcrypt.compare(password, hash)
                        : verifyPassword({ hash, password }),
            },
        },
        // Middleware and requireWorkspaceContext read the session on every
        // request; the signed cookie cache answers most of those without a
        // database round-trip. 60s staleness matches the spirit of the 10s
        // role cache middleware already keeps.
        session: {
            cookieCache: { enabled: true, maxAge: 60 },
        },
        socialProviders: {
            ...(google
                ? {
                      google: {
                          clientId: process.env.AUTH_GOOGLE_CLIENT_ID!,
                          clientSecret: process.env.AUTH_GOOGLE_CLIENT_SECRET!,
                      },
                  }
                : {}),
            ...(github
                ? {
                      github: {
                          clientId: process.env.AUTH_GITHUB_CLIENT_ID!,
                          clientSecret: process.env.AUTH_GITHUB_CLIENT_SECRET!,
                      },
                  }
                : {}),
        },
        plugins: [nextCookies()],
    });
};

type Auth = ReturnType<typeof buildAuth>;

let _auth: Auth | null = null;
const getAuth = (): Auth => (_auth ??= buildAuth());

export const auth: Auth = new Proxy({} as Auth, {
    get(_target, prop, receiver) {
        const instance = getAuth();
        const value = Reflect.get(instance, prop, receiver) as unknown;
        if (typeof value === "function") {
            return (value as (...args: unknown[]) => unknown).bind(instance);
        }
        return value;
    },
});

/** Session read for middleware, which already holds the request's headers. */
export async function getSessionFromHeaders(headers: Headers) {
    return getAuth().api.getSession({ headers });
}

/**
 * Session read for route handlers and server components — resolves the
 * request headers itself so callers (and their tests) deal with one module.
 */
export async function getServerSession() {
    const { headers } = await import("next/headers");
    return getAuth().api.getSession({ headers: await headers() });
}
