/**
 * LinkedIn OAuth 2.0 (3-legged) — a workspace member signs in and the grant
 * is the member's: it can post as them and, when the deployment's LinkedIn
 * app has the Community Management API, as every Page they administer
 * (Brand turns each into a channel; see `~/server/brand/channels`).
 *
 * The scopes are the deployment's to choose, because LinkedIn decides them
 * per app: a self-serve app (Share on LinkedIn + Sign In with OpenID Connect)
 * grants `openid profile email w_member_social`; a Community Management app
 * grants the organization scopes. Asking for a scope the app does not have
 * fails the consent screen, and asking a member for a different set than
 * before cancels their earlier tokens — so the set is one env value, copied
 * from the app's Auth tab, and never varies per request.
 *
 * Access tokens last 60 days. Only approved Marketing Developer Platform
 * apps receive refresh tokens (365 days, not extended by use); without one
 * the connection simply runs out and Accounts asks for a reconnect.
 */

import { getLinkedInMember } from "@launchstack/tools/social-publish/linkedin";

import {
    ConnectorGrantRevokedError,
    ConnectorOAuthError,
    postForm,
    readTokenError,
    type ProviderGrant,
    type ProviderOAuthConfig,
    type RefreshedProviderToken,
} from "./types";

export const LINKEDIN_OAUTH_BASE = "https://www.linkedin.com/oauth/v2";

/** What a self-serve app (no review) can grant: post as the member, know who they are. */
export const LINKEDIN_DEFAULT_SCOPES: readonly string[] = [
    "openid",
    "profile",
    "email",
    "w_member_social",
];

function base(config: ProviderOAuthConfig): string {
    return (config.authBaseUrl ?? LINKEDIN_OAUTH_BASE).replace(/\/+$/, "");
}

function scopes(config: ProviderOAuthConfig): readonly string[] {
    return config.scopes && config.scopes.length > 0 ? config.scopes : LINKEDIN_DEFAULT_SCOPES;
}

/** LinkedIn reports granted scopes comma-separated; the connection row stores them space-separated. */
export function normalizeLinkedInScopes(
    raw: string | undefined,
    fallback: readonly string[]
): string {
    const list = (raw ?? "")
        .split(/[\s,]+/)
        .map(s => s.trim())
        .filter(Boolean);
    return (list.length > 0 ? list : fallback).join(" ");
}

export function buildAuthUrl(config: ProviderOAuthConfig, state: string): string {
    const url = new URL(`${base(config)}/authorization`);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", config.clientId);
    url.searchParams.set("redirect_uri", config.redirectUri);
    url.searchParams.set("state", state);
    url.searchParams.set("scope", scopes(config).join(" "));
    return url.toString();
}

interface LinkedInTokenPayload {
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
    refresh_token_expires_in?: number;
    scope?: string;
    error?: string;
    error_description?: string;
}

function expiry(seconds: number | undefined): Date | null {
    return typeof seconds === "number" && seconds > 0
        ? new Date(Date.now() + seconds * 1000)
        : null;
}

export async function exchangeCode(
    config: ProviderOAuthConfig,
    code: string
): Promise<ProviderGrant> {
    const fetchImpl = config.fetch ?? fetch;
    const response = await postForm(fetchImpl, `${base(config)}/accessToken`, {
        grant_type: "authorization_code",
        code,
        redirect_uri: config.redirectUri,
        client_id: config.clientId,
        client_secret: config.clientSecret,
    });
    if (!response.ok) {
        throw new ConnectorOAuthError(
            `LinkedIn code exchange failed: ${await readTokenError(response)}`,
            response.status
        );
    }
    const payload = (await response.json()) as LinkedInTokenPayload;
    if (!payload.access_token) {
        throw new ConnectorOAuthError("LinkedIn code exchange returned no access token");
    }
    // The grant's identity is the member: their person id keys the
    // connection, so reconnecting the same person converges on one row.
    const member = await getLinkedInMember({
        accessToken: payload.access_token,
        fetch: config.fetch,
        apiBaseUrl: config.apiBaseUrl,
    });
    return {
        providerAccountId: member.id,
        displayName: member.name ?? member.email,
        scopes: normalizeLinkedInScopes(payload.scope, scopes(config)),
        accessToken: payload.access_token,
        accessTokenExpiresAt: expiry(payload.expires_in),
        refreshToken: payload.refresh_token ?? null,
    };
}

export async function refreshAccessToken(
    config: ProviderOAuthConfig,
    refreshToken: string
): Promise<RefreshedProviderToken> {
    const fetchImpl = config.fetch ?? fetch;
    const response = await postForm(fetchImpl, `${base(config)}/accessToken`, {
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: config.clientId,
        client_secret: config.clientSecret,
    });
    if (!response.ok) {
        const message = await readTokenError(response);
        // invalid_grant covers an expired, revoked or already-replaced refresh token.
        if (response.status === 400 || response.status === 401) {
            throw new ConnectorGrantRevokedError("LinkedIn");
        }
        throw new ConnectorOAuthError(`LinkedIn token refresh failed: ${message}`, response.status);
    }
    const payload = (await response.json()) as LinkedInTokenPayload;
    if (!payload.access_token) {
        throw new ConnectorOAuthError("LinkedIn token refresh returned no access token");
    }
    return {
        accessToken: payload.access_token,
        accessTokenExpiresAt: expiry(payload.expires_in),
        // LinkedIn keeps the same refresh token until it expires; it only
        // sends one back when it issued a new one.
        refreshToken: payload.refresh_token ?? null,
    };
}

/** Best-effort revocation on disconnect; failures are the caller's to ignore. */
export async function revokeToken(config: ProviderOAuthConfig, token: string): Promise<boolean> {
    const fetchImpl = config.fetch ?? fetch;
    try {
        const response = await postForm(fetchImpl, `${base(config)}/revoke`, {
            token,
            client_id: config.clientId,
            client_secret: config.clientSecret,
        });
        return response.ok;
    } catch {
        return false;
    }
}
