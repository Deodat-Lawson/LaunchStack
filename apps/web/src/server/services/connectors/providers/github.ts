/**
 * GitHub OAuth app — auth-code flow yielding a user-bound token, stored as a
 * workspace connection. The `repo` scope is deliberately coarse: GitHub OAuth
 * apps offer no read-only repo scope, and both consumers (repo explainer,
 * repo upload) need private-repo reads. A GitHub App installation (org-scoped,
 * fine-grained, survives personnel churn) is the documented upgrade path.
 *
 * Classic OAuth tokens do not expire; when the app opts into expiring user
 * tokens the exchange carries expires_in + refresh_token and the refresh path
 * below handles it.
 */

import {
    ConnectorGrantRevokedError,
    ConnectorOAuthError,
    postForm,
    type FetchLike,
    type ProviderGrant,
    type ProviderOAuthConfig,
    type RefreshedProviderToken,
} from "./types";

const AUTH_ENDPOINT = "https://github.com/login/oauth/authorize";
const TOKEN_ENDPOINT = "https://github.com/login/oauth/access_token";
const USER_ENDPOINT = "https://api.github.com/user";
const USER_AGENT = "LaunchStack-Connector";

export const GITHUB_SCOPES: readonly string[] = ["repo", "read:user"];

export function buildAuthUrl(config: ProviderOAuthConfig, state: string): string {
    const url = new URL(AUTH_ENDPOINT);
    url.searchParams.set("client_id", config.clientId);
    url.searchParams.set("redirect_uri", config.redirectUri);
    url.searchParams.set("scope", GITHUB_SCOPES.join(" "));
    url.searchParams.set("state", state);
    return url.toString();
}

interface GitHubTokenPayload {
    error?: string;
    error_description?: string;
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
}

async function fetchViewer(
    fetchImpl: FetchLike,
    accessToken: string
): Promise<{ id: string; login: string | null }> {
    const response = await fetchImpl(USER_ENDPOINT, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/vnd.github+json",
            "User-Agent": USER_AGENT,
        },
    });
    if (!response.ok) {
        throw new ConnectorOAuthError(
            `GitHub viewer lookup failed: HTTP ${response.status}`,
            response.status
        );
    }
    const payload = (await response.json()) as { id?: number; login?: string };
    if (payload.id == null) {
        throw new ConnectorOAuthError("GitHub viewer lookup returned no id");
    }
    return { id: String(payload.id), login: payload.login ?? null };
}

export async function exchangeCode(
    config: ProviderOAuthConfig,
    code: string
): Promise<ProviderGrant> {
    const fetchImpl = config.fetch ?? fetch;
    const response = await postForm(
        fetchImpl,
        TOKEN_ENDPOINT,
        {
            client_id: config.clientId,
            client_secret: config.clientSecret,
            redirect_uri: config.redirectUri,
            code,
        },
        { Accept: "application/json" }
    );
    // GitHub answers 200 with {error} on failure; HTTP status is not signal.
    const payload = (await response.json()) as GitHubTokenPayload;
    if (payload.error || !payload.access_token) {
        throw new ConnectorOAuthError(
            `GitHub code exchange failed: ${payload.error_description ?? payload.error ?? `HTTP ${response.status}`}`,
            response.status
        );
    }
    const viewer = await fetchViewer(fetchImpl, payload.access_token);
    return {
        providerAccountId: viewer.id,
        displayName: viewer.login,
        scopes: (payload.scope ?? "").split(",").filter(Boolean).join(" "),
        accessToken: payload.access_token,
        accessTokenExpiresAt: payload.expires_in
            ? new Date(Date.now() + payload.expires_in * 1000)
            : null,
        refreshToken: payload.refresh_token ?? null,
    };
}

export async function refreshAccessToken(
    config: ProviderOAuthConfig,
    refreshToken: string
): Promise<RefreshedProviderToken> {
    const fetchImpl = config.fetch ?? fetch;
    const response = await postForm(
        fetchImpl,
        TOKEN_ENDPOINT,
        {
            client_id: config.clientId,
            client_secret: config.clientSecret,
            grant_type: "refresh_token",
            refresh_token: refreshToken,
        },
        { Accept: "application/json" }
    );
    const payload = (await response.json()) as GitHubTokenPayload;
    if (payload.error || !payload.access_token) {
        const error = payload.error ?? `HTTP ${response.status}`;
        if (error === "bad_refresh_token") throw new ConnectorGrantRevokedError("GitHub");
        throw new ConnectorOAuthError(
            `GitHub token refresh failed: ${payload.error_description ?? error}`,
            response.status
        );
    }
    return {
        accessToken: payload.access_token,
        accessTokenExpiresAt: payload.expires_in
            ? new Date(Date.now() + payload.expires_in * 1000)
            : null,
        // GitHub rotates the refresh token on every refresh.
        refreshToken: payload.refresh_token ?? null,
    };
}

/** Best-effort revocation on disconnect; failures are the caller's to ignore. */
export async function revokeToken(
    config: Pick<ProviderOAuthConfig, "clientId" | "clientSecret" | "fetch">,
    token: string
): Promise<boolean> {
    const fetchImpl = config.fetch ?? fetch;
    const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
    const response = await fetchImpl(
        `https://api.github.com/applications/${encodeURIComponent(config.clientId)}/grant`,
        {
            method: "DELETE",
            headers: {
                Authorization: `Basic ${basic}`,
                Accept: "application/vnd.github+json",
                "User-Agent": USER_AGENT,
            },
            body: JSON.stringify({ access_token: token }),
        }
    );
    // 204 on success; 404 means the grant was already gone, which is fine.
    return response.status === 204 || response.status === 404;
}
