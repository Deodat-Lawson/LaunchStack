/**
 * OAuth clients an admin creates by hand, for assistants that ask for a
 * client ID and secret instead of registering themselves. Gemini Enterprise
 * is the one that needs it today: its "Custom MCP Server" data store takes a
 * client ID, a client secret, the authorization and token URLs, and calls
 * back to a fixed Google redirect URI.
 *
 * The client is created through better-auth's own server API
 * (`adminCreateOAuthClient`), so the secret is generated and stored (hashed)
 * exactly as for every other client. better-auth makes the admin who created
 * it the owner; this module then hands ownership to the workspace instead:
 * `reference_id` becomes the company id and `user_id` is cleared. That keeps
 * the list per workspace, lets any admin there delete it, and stops the
 * creator from still managing it through better-auth's own client endpoints
 * after they lose the role (with no `clientReference` configured, those
 * endpoints refuse a workspace-owned client to everyone).
 *
 * Owning the client does not decide whose data it reaches. Each person who
 * connects through it still signs in as themselves, picks a workspace and
 * consents; the token carries that person and that workspace.
 */
import { APIError } from "better-auth/api";
import { and, count, desc, eq } from "drizzle-orm";

import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { authOauthClient } from "~/server/db/schema/auth";
import { MCP_OAUTH_SCOPES, MCP_SCOPE_READ, MCP_SCOPE_WRITE } from "./config";

/** Where Gemini Enterprise sends people back after they sign in. */
export const GEMINI_ENTERPRISE_REDIRECT_URI =
    "https://vertexaisearch.cloud.google.com/oauth-redirect";

export const OAUTH_CLIENT_NAME_MAX = 80;
export const OAUTH_CLIENT_REDIRECTS_MAX = 5;
/** A workspace can hold this many hand-made clients. */
export const OAUTH_CLIENTS_PER_WORKSPACE = 20;

/** How the assistant presents its secret at the token endpoint. better-auth enforces the one registered. */
export const MANUAL_CLIENT_AUTH_METHODS = ["client_secret_post", "client_secret_basic"] as const;
export type ManualClientAuthMethod = (typeof MANUAL_CLIENT_AUTH_METHODS)[number];

/** What an admin pastes into an assistant's manual OAuth fields. */
export interface OAuthEndpoints {
    /** better-auth's issuer: the app origin plus its /api/auth base path. */
    issuer: string;
    authorization: string;
    token: string;
    /** OpenID discovery document for the issuer, served by better-auth itself. */
    discovery: string;
    /** Space-separated, in the order an assistant's "Scopes" field takes them. */
    scopes: string;
}

/**
 * The real paths, from the oauth-provider plugin under better-auth's
 * `/api/auth` base path (checked against the running server's discovery
 * document).
 */
export function oauthEndpoints(origin: string): OAuthEndpoints {
    const issuer = `${origin}/api/auth`;
    return {
        issuer,
        authorization: `${issuer}/oauth2/authorize`,
        token: `${issuer}/oauth2/token`,
        discovery: `${issuer}/.well-known/openid-configuration`,
        // offline_access so the assistant gets a refresh token instead of a
        // fresh sign-in every hour; write so it can save conversations.
        scopes: ["openid", "offline_access", MCP_SCOPE_READ, MCP_SCOPE_WRITE].join(" "),
    };
}

/** What the admin list shows — never the secret or its hash. */
export interface ManualClientSummary {
    clientId: string;
    name: string;
    redirectUris: string[];
    authMethod: string;
    createdAt: string | null;
}

export class OAuthClientLimitError extends Error {
    constructor() {
        super(`A workspace can hold at most ${OAUTH_CLIENTS_PER_WORKSPACE} OAuth clients.`);
    }
}

/** better-auth refused the client's metadata (a redirect URI it won't accept, say). */
export class OAuthClientInputError extends Error {}

const reference = (companyId: bigint) => String(companyId);

const SUMMARY_COLUMNS = {
    clientId: authOauthClient.clientId,
    name: authOauthClient.name,
    redirectUris: authOauthClient.redirectUris,
    authMethod: authOauthClient.tokenEndpointAuthMethod,
    createdAt: authOauthClient.createdAt,
};

type SummaryRow = {
    clientId: string;
    name: string | null;
    redirectUris: string[];
    authMethod: string | null;
    createdAt: Date | null;
};

function summarize(row: SummaryRow): ManualClientSummary {
    const name = (row.name ?? "").trim();
    return {
        clientId: row.clientId,
        name: name.length > 0 ? name : "Unnamed client",
        redirectUris: row.redirectUris ?? [],
        authMethod: row.authMethod ?? "client_secret_basic",
        createdAt: row.createdAt?.toISOString() ?? null,
    };
}

export async function listManualClients(input: {
    companyId: bigint;
}): Promise<ManualClientSummary[]> {
    const rows = await db
        .select(SUMMARY_COLUMNS)
        .from(authOauthClient)
        .where(eq(authOauthClient.referenceId, reference(input.companyId)))
        .orderBy(desc(authOauthClient.createdAt));
    return rows.map(summarize);
}

function refusal(error: unknown): string | null {
    if (!(error instanceof APIError) || error.statusCode !== 400) return null;
    const body = error.body as { error_description?: unknown; message?: unknown } | undefined;
    const detail = body?.error_description ?? body?.message ?? error.message;
    return typeof detail === "string" && detail ? detail : "The client details were refused.";
}

/**
 * Creates a confidential client for this workspace and returns its secret —
 * the only time it is ever readable. `headers` are the admin's own request
 * headers: better-auth's create endpoint requires a signed-in session.
 */
export async function createManualClient(input: {
    headers: Headers;
    companyId: bigint;
    name: string;
    redirectUris: string[];
    authMethod: ManualClientAuthMethod;
}): Promise<{ client: ManualClientSummary; clientSecret: string }> {
    const [existing] = await db
        .select({ n: count() })
        .from(authOauthClient)
        .where(eq(authOauthClient.referenceId, reference(input.companyId)));
    if ((existing?.n ?? 0) >= OAUTH_CLIENTS_PER_WORKSPACE) throw new OAuthClientLimitError();

    let created: { client_id: string; client_secret?: string };
    try {
        created = await auth.api.adminCreateOAuthClient({
            headers: input.headers,
            body: {
                client_name: input.name.trim().slice(0, OAUTH_CLIENT_NAME_MAX),
                redirect_uris: input.redirectUris,
                token_endpoint_auth_method: input.authMethod,
                grant_types: ["authorization_code", "refresh_token"],
                response_types: ["code"],
                application_type: "web",
                scope: MCP_OAUTH_SCOPES.join(" "),
                // A confidential client proves itself with its secret at the
                // token endpoint; PKCE stays on whenever the assistant sends
                // it, and better-auth still demands PKCE (or an OIDC nonce)
                // for any request that asks for offline_access.
                require_pkce: false,
            },
        });
    } catch (error) {
        const reason = refusal(error);
        if (reason) throw new OAuthClientInputError(reason);
        throw error;
    }

    const removeCreated = () =>
        db.delete(authOauthClient).where(eq(authOauthClient.clientId, created.client_id));

    if (!created.client_secret) {
        await removeCreated();
        throw new Error("The OAuth provider created a client without a secret.");
    }

    let row: SummaryRow | undefined;
    try {
        [row] = await db
            .update(authOauthClient)
            .set({ referenceId: reference(input.companyId), userId: null })
            .where(eq(authOauthClient.clientId, created.client_id))
            .returning(SUMMARY_COLUMNS);
    } catch (error) {
        // A client nobody can list or delete from Settings is worse than none.
        await removeCreated().catch(() => undefined);
        throw error;
    }
    if (!row) throw new Error("The new OAuth client disappeared before it could be assigned.");

    return { client: summarize(row), clientSecret: created.client_secret };
}

/**
 * Deletes one of this workspace's hand-made clients. Its consents, codes and
 * tokens go with it (the OAuth tables cascade on the client), so every person
 * connected through it is cut off at their next request. False when the
 * workspace has no such client.
 */
export async function deleteManualClient(input: {
    companyId: bigint;
    clientId: string;
}): Promise<boolean> {
    const rows = await db
        .delete(authOauthClient)
        .where(
            and(
                eq(authOauthClient.clientId, input.clientId),
                eq(authOauthClient.referenceId, reference(input.companyId))
            )
        )
        .returning({ clientId: authOauthClient.clientId });
    return rows.length > 0;
}
