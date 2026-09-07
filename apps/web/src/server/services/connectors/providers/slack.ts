/**
 * Slack OAuth v2 — installs the deployment's Slack app into one Slack
 * workspace and yields a team-scoped bot token. Slack's own model is
 * workspace-to-workspace, so the grant identity is the team, not the human
 * who clicked through the consent screen.
 *
 * Bot tokens do not expire unless the Slack app has token rotation enabled;
 * when it is enabled the exchange carries refresh_token + expires_in and the
 * refresh path below handles it.
 */

import {
    ConnectorGrantRevokedError,
    ConnectorOAuthError,
    postForm,
    type ProviderGrant,
    type ProviderOAuthConfig,
    type RefreshedProviderToken,
} from "./types";

const AUTH_ENDPOINT = "https://slack.com/oauth/v2/authorize";
const TOKEN_ENDPOINT = "https://slack.com/api/oauth.v2.access";
const REVOKE_ENDPOINT = "https://slack.com/api/auth.revoke";

/**
 * The four calls HttpSlackClient makes (postMessage, createChannel, history,
 * userInfo) plus channel listing for a future channel picker.
 */
export const SLACK_BOT_SCOPES: readonly string[] = [
    "chat:write",
    "channels:read",
    "channels:manage",
    "channels:history",
    "users:read",
];

export function buildAuthUrl(config: ProviderOAuthConfig, state: string): string {
    const url = new URL(AUTH_ENDPOINT);
    url.searchParams.set("client_id", config.clientId);
    url.searchParams.set("redirect_uri", config.redirectUri);
    url.searchParams.set("scope", SLACK_BOT_SCOPES.join(","));
    url.searchParams.set("state", state);
    return url.toString();
}

interface SlackAccessPayload {
    ok?: boolean;
    error?: string;
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    team?: { id?: string; name?: string };
}

export async function exchangeCode(
    config: ProviderOAuthConfig,
    code: string
): Promise<ProviderGrant> {
    const fetchImpl = config.fetch ?? fetch;
    const response = await postForm(fetchImpl, TOKEN_ENDPOINT, {
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri,
        code,
    });
    // Slack answers 200 with {ok:false} on failure; HTTP status is not signal.
    const payload = (await response.json()) as SlackAccessPayload;
    if (!payload.ok || !payload.access_token) {
        throw new ConnectorOAuthError(
            `Slack code exchange failed: ${payload.error ?? `HTTP ${response.status}`}`,
            response.status
        );
    }
    if (!payload.team?.id) {
        throw new ConnectorOAuthError("Slack code exchange returned no team id");
    }
    return {
        providerAccountId: payload.team.id,
        displayName: payload.team.name ?? null,
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
    const response = await postForm(fetchImpl, TOKEN_ENDPOINT, {
        client_id: config.clientId,
        client_secret: config.clientSecret,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
    });
    const payload = (await response.json()) as SlackAccessPayload;
    if (!payload.ok || !payload.access_token) {
        const error = payload.error ?? `HTTP ${response.status}`;
        if (error === "invalid_refresh_token" || error === "token_revoked") {
            throw new ConnectorGrantRevokedError("Slack");
        }
        throw new ConnectorOAuthError(`Slack token refresh failed: ${error}`, response.status);
    }
    return {
        accessToken: payload.access_token,
        accessTokenExpiresAt: payload.expires_in
            ? new Date(Date.now() + payload.expires_in * 1000)
            : null,
        // Slack rotation issues a new refresh token on every refresh.
        refreshToken: payload.refresh_token ?? null,
    };
}

/** Best-effort revocation on disconnect; failures are the caller's to ignore. */
export async function revokeToken(
    config: Pick<ProviderOAuthConfig, "fetch">,
    token: string
): Promise<boolean> {
    const fetchImpl = config.fetch ?? fetch;
    const response = await fetchImpl(REVOKE_ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return false;
    try {
        const payload = (await response.json()) as { ok?: boolean };
        return payload.ok === true;
    } catch {
        return false;
    }
}
