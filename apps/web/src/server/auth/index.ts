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
 *
 * It is also the OAuth server for the MCP server (/api/mcp): assistants such
 * as Claude, ChatGPT and Gemini register as clients (dynamic registration or
 * a client ID metadata document), the person signs in here, picks a
 * workspace, consents, and the assistant gets a JWT bound to that workspace.
 * See ~/server/mcp. Off when ~/server/mcp/config says so.
 */
import { betterAuth } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import { nextCookies } from "better-auth/next-js";
import { jwt, lastLoginMethod } from "better-auth/plugins";
import { cimd } from "@better-auth/cimd";
import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import { mcp } from "@better-auth/mcp";
import bcrypt from "bcryptjs";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import {
    authAccount,
    authJwks,
    authOauthAccessToken,
    authOauthClient,
    authOauthClientAssertion,
    authOauthClientResource,
    authOauthConsent,
    authOauthRefreshToken,
    authOauthResource,
    authSession,
    authUser,
    authVerification,
} from "~/server/db/schema/auth";
import { MCP_OAUTH_SCOPES, mcpAvailability } from "~/server/mcp/config";
import { workspaceAccessTokenClaims, workspacePostLogin } from "~/server/mcp/oauth-workspace";
import { sendAuthEmail } from "./email";
import { enabledSocialProviders } from "./providers";

// process.env directly, not ~/env — the same trade the middleware's own DB
// client makes. This module sits in the middleware bundle, and ~/env drags
// dotenv + import.meta resolution in with it; the variables read here are
// still declared and validated in env.ts via the app's other import paths.
const buildAuth = () => {
    const client = postgres(process.env.DATABASE_URL!, { max: 5 });
    const authTables = {
        user: authUser,
        session: authSession,
        account: authAccount,
        verification: authVerification,
        jwks: authJwks,
        oauthClient: authOauthClient,
        oauthResource: authOauthResource,
        oauthClientResource: authOauthClientResource,
        oauthRefreshToken: authOauthRefreshToken,
        oauthAccessToken: authOauthAccessToken,
        oauthConsent: authOauthConsent,
        oauthClientAssertion: authOauthClientAssertion,
    };
    const db = drizzle(client, { schema: authTables });

    const social = enabledSocialProviders();
    const google = social.includes("google");
    const github = social.includes("github");

    return betterAuth({
        secret: process.env.BETTER_AUTH_SECRET,
        baseURL: process.env.BETTER_AUTH_URL,
        database: drizzleAdapter(db, { provider: "pg", schema: authTables }),
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
        // OAuth failures that happen before a sign-in's own errorCallbackURL
        // is known (a lost state cookie, a malformed callback) land here
        // instead of better-auth's bare /api/auth/error page. The sign-in page
        // turns `?error=<code>` into a sentence.
        onAPIError: { errorURL: "/signin" },
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
        plugins: [
            // Sets a readable 30-day cookie naming the method behind each new
            // session ("email", "google", "github"), so the sign-in page can
            // mark it "Last used". Cookie only — no column, no migration.
            lastLoginMethod(),
            ...mcpPlugins(db),
            // Last, per better-auth: it forwards cookies the hooks above set.
            nextCookies(),
        ],
    });
};

/**
 * The OAuth provider for assistants, or nothing when the MCP server is off.
 *
 * Registration: open dynamic registration (Claude, ChatGPT, Codex and Gemini
 * CLI use it) plus client ID metadata documents, which the MCP 2026-07-28
 * spec prefers. The CIMD fetcher is better-auth's own Node transport: it
 * resolves the client's URL once, refuses private addresses and pins the
 * connection. Admins can also create clients with a secret for assistants
 * that take manual OAuth fields (Gemini Enterprise) — see ~/server/mcp.
 */
function mcpPlugins(db: Parameters<typeof workspacePostLogin>[0]) {
    const availability = mcpAvailability();
    if (!availability.enabled) return [];
    return [
        jwt(),
        mcp({
            resource: availability.resource,
            loginPage: "/signin",
            consentPage: "/oauth/consent",
            scopes: [...MCP_OAUTH_SCOPES],
            // Every grant is a person in a workspace; no client_credentials.
            grantTypes: ["authorization_code", "refresh_token"],
            allowDynamicClientRegistration: true,
            allowUnauthenticatedClientRegistration: true,
            // Some MCP clients omit application_type at registration.
            clientRegistrationDefaultApplicationType: "infer",
            accessTokenExpiresIn: 60 * 60,
            postLogin: workspacePostLogin(db, "/oauth/workspace"),
            customAccessTokenClaims: workspaceAccessTokenClaims(db),
        }),
        cimd({ fetchClientMetadataResource, metadataProfile: "mcp-2026-07-28" }),
        defaultMcpResource(availability.resource),
    ];
}

/**
 * Fills in `resource` (RFC 8707) on an authorization request that has none.
 *
 * better-auth binds a token to the MCP server — a JWT whose audience is
 * /api/mcp — only when the client names that resource. A client that leaves
 * it out (the MCP spec says it should send it; Gemini Enterprise's manual
 * OAuth fields have no place for it) would get an opaque token /api/mcp
 * cannot verify. This server protects exactly one resource, so that is the
 * default. The signed request the later steps resume from includes it, and
 * so does the authorization code.
 */
function defaultMcpResource(resource: string) {
    return {
        id: "launchstack-mcp-default-resource",
        hooks: {
            before: [
                {
                    matcher: (ctx: { path?: string; query?: Record<string, unknown> }) =>
                        ctx.path === "/oauth2/authorize" && !ctx.query?.resource,
                    handler: createAuthMiddleware(async ctx => ({
                        context: { query: { ...ctx.query, resource } },
                    })),
                },
            ],
        },
    };
}

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
