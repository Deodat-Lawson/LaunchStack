/**
 * Notion public connection (OAuth 2.0) — an admin approves on Notion's own
 * consent screen, whose page picker decides which pages and databases the
 * integration may read. Notion has no OAuth scopes: what the token can do is
 * the capabilities set on the connection in Notion's developer portal (read
 * content only, for this app).
 *
 * The grant identity is the `bot_id`, which Notion guarantees unique per
 * token; one Notion workspace can hold several tokens, so `workspace_id` is
 * not an identity. Re-authorizing as the same user returns the same token,
 * so a reconnect converges on its existing row.
 *
 * Unlike the other providers, the token endpoints take HTTP Basic client
 * auth and a JSON body, and every call carries a Notion-Version header. The
 * token response has no `expires_in`, so a token is stored as long-lived;
 * refresh rotates the refresh token.
 */

import {
    ConnectorGrantRevokedError,
    ConnectorOAuthError,
    type FetchLike,
    type ProviderGrant,
    type ProviderOAuthConfig,
    type RefreshedProviderToken,
} from "./types";

const AUTH_ENDPOINT = "https://api.notion.com/v1/oauth/authorize";
const TOKEN_ENDPOINT = "https://api.notion.com/v1/oauth/token";
const REVOKE_ENDPOINT = "https://api.notion.com/v1/oauth/revoke";

export const NOTION_API_VERSION = "2026-03-11";

function basicAuth(config: Pick<ProviderOAuthConfig, "clientId" | "clientSecret">): string {
    return `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`;
}

async function postJson(
    fetchImpl: FetchLike,
    url: string,
    body: Record<string, string>,
    config: Pick<ProviderOAuthConfig, "clientId" | "clientSecret">
): Promise<Response> {
    return fetchImpl(url, {
        method: "POST",
        headers: {
            Authorization: basicAuth(config),
            "Content-Type": "application/json",
            "Notion-Version": NOTION_API_VERSION,
        },
        body: JSON.stringify(body),
    });
}

export function buildAuthUrl(config: ProviderOAuthConfig, state: string): string {
    const url = new URL(AUTH_ENDPOINT);
    url.searchParams.set("client_id", config.clientId);
    url.searchParams.set("redirect_uri", config.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("owner", "user");
    url.searchParams.set("state", state);
    return url.toString();
}

interface NotionTokenPayload {
    access_token?: string;
    refresh_token?: string | null;
    expires_in?: number;
    bot_id?: string;
    workspace_id?: string;
    workspace_name?: string | null;
    // OAuth-style failures carry error/error_description; API-style ones code/message.
    error?: string;
    error_description?: string;
    code?: string;
    message?: string;
}

async function readPayload(response: Response): Promise<NotionTokenPayload> {
    try {
        return (await response.json()) as NotionTokenPayload;
    } catch {
        return {};
    }
}

function errorCode(payload: NotionTokenPayload, response: Response): string {
    return payload.error ?? payload.code ?? `HTTP ${response.status}`;
}

function errorDetail(payload: NotionTokenPayload, response: Response): string {
    return payload.error_description ?? payload.message ?? errorCode(payload, response);
}

function expiresAt(payload: NotionTokenPayload): Date | null {
    return payload.expires_in ? new Date(Date.now() + payload.expires_in * 1000) : null;
}

export async function exchangeCode(
    config: ProviderOAuthConfig,
    code: string
): Promise<ProviderGrant> {
    const fetchImpl = config.fetch ?? fetch;
    // redirect_uri went into the authorize URL, so Notion requires it here too.
    const response = await postJson(
        fetchImpl,
        TOKEN_ENDPOINT,
        { grant_type: "authorization_code", code, redirect_uri: config.redirectUri },
        config
    );
    const payload = await readPayload(response);
    if (!response.ok || !payload.access_token) {
        throw new ConnectorOAuthError(
            `Notion code exchange failed: ${errorDetail(payload, response)}`,
            response.status
        );
    }
    if (!payload.bot_id) {
        throw new ConnectorOAuthError("Notion code exchange returned no bot id");
    }
    return {
        providerAccountId: payload.bot_id,
        displayName: payload.workspace_name ?? null,
        // Notion grants no OAuth scopes; the column is NOT NULL.
        scopes: "",
        accessToken: payload.access_token,
        accessTokenExpiresAt: expiresAt(payload),
        refreshToken: payload.refresh_token ?? null,
    };
}

export async function refreshAccessToken(
    config: ProviderOAuthConfig,
    refreshToken: string
): Promise<RefreshedProviderToken> {
    const fetchImpl = config.fetch ?? fetch;
    const response = await postJson(
        fetchImpl,
        TOKEN_ENDPOINT,
        { grant_type: "refresh_token", refresh_token: refreshToken },
        config
    );
    const payload = await readPayload(response);
    if (!response.ok || !payload.access_token) {
        if (errorCode(payload, response) === "invalid_grant") {
            throw new ConnectorGrantRevokedError("Notion");
        }
        throw new ConnectorOAuthError(
            `Notion token refresh failed: ${errorDetail(payload, response)}`,
            response.status
        );
    }
    return {
        accessToken: payload.access_token,
        accessTokenExpiresAt: expiresAt(payload),
        // Notion rotates the refresh token on every refresh.
        refreshToken: payload.refresh_token ?? null,
    };
}

/** Best-effort revocation on disconnect; failures are the caller's to ignore. */
export async function revokeToken(
    config: Pick<ProviderOAuthConfig, "clientId" | "clientSecret" | "fetch">,
    token: string
): Promise<boolean> {
    const fetchImpl = config.fetch ?? fetch;
    const response = await postJson(fetchImpl, REVOKE_ENDPOINT, { token }, config);
    return response.ok;
}
