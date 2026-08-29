/**
 * Google OAuth 2.0 for the Drive connection — auth-code + offline refresh.
 *
 * drive.file is the non-sensitive scope: the app sees only what the user
 * picks in the Google Picker, and needs no Google verification. openid +
 * email identify which Google account was connected.
 */

import {
    ConnectorGrantRevokedError,
    ConnectorOAuthError,
    postForm,
    readTokenError,
    type ProviderGrant,
    type ProviderOAuthConfig,
    type RefreshedProviderToken,
} from "./types";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";

export const GOOGLE_DRIVE_SCOPES: readonly string[] = [
    "https://www.googleapis.com/auth/drive.file",
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
];

export function buildAuthUrl(config: ProviderOAuthConfig, state: string): string {
    const url = new URL(AUTH_ENDPOINT);
    url.searchParams.set("client_id", config.clientId);
    url.searchParams.set("redirect_uri", config.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", GOOGLE_DRIVE_SCOPES.join(" "));
    // offline + consent guarantees a refresh_token in the exchange response.
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("include_granted_scopes", "true");
    url.searchParams.set("state", state);
    return url.toString();
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
        grant_type: "authorization_code",
        code,
    });
    if (!response.ok) {
        throw new ConnectorOAuthError(
            `Google code exchange failed: ${await readTokenError(response)}`,
            response.status
        );
    }
    const payload = (await response.json()) as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
        scope?: string;
        id_token?: string;
    };
    if (!payload.access_token) {
        throw new ConnectorOAuthError("Google code exchange returned no access_token");
    }
    if (!payload.refresh_token) {
        // With prompt=consent this should never happen; failing loudly beats
        // storing a connection that dies within the hour.
        throw new ConnectorOAuthError("Google code exchange returned no refresh_token");
    }
    const claims = payload.id_token
        ? decodeIdTokenClaims(payload.id_token)
        : { email: null, sub: null };
    if (!claims.sub) {
        throw new ConnectorOAuthError("Google id_token carried no subject claim");
    }
    return {
        providerAccountId: claims.sub,
        displayName: claims.email,
        scopes: payload.scope ?? "",
        accessToken: payload.access_token,
        accessTokenExpiresAt: new Date(Date.now() + (payload.expires_in ?? 3600) * 1000),
        refreshToken: payload.refresh_token,
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
    if (!response.ok) {
        const detail = await readTokenError(response);
        if (detail.includes("invalid_grant")) throw new ConnectorGrantRevokedError("Google");
        throw new ConnectorOAuthError(`Google token refresh failed: ${detail}`, response.status);
    }
    const payload = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!payload.access_token) {
        throw new ConnectorOAuthError("Google token refresh returned no access_token");
    }
    return {
        accessToken: payload.access_token,
        accessTokenExpiresAt: new Date(Date.now() + (payload.expires_in ?? 3600) * 1000),
        refreshToken: null,
    };
}

/** Best-effort revocation on disconnect; failures are the caller's to ignore. */
export async function revokeToken(
    config: Pick<ProviderOAuthConfig, "fetch">,
    token: string
): Promise<boolean> {
    const fetchImpl = config.fetch ?? fetch;
    const response = await postForm(fetchImpl, REVOKE_ENDPOINT, { token });
    return response.ok;
}

interface IdTokenClaims {
    readonly email: string | null;
    readonly sub: string | null;
}

/**
 * Reads email/sub out of the id_token payload without signature verification —
 * acceptable only because the token arrives directly from Google's token
 * endpoint over TLS, never from the browser.
 */
function decodeIdTokenClaims(idToken: string): IdTokenClaims {
    const segments = idToken.split(".");
    const payload = segments[1];
    if (!payload) return { email: null, sub: null };
    try {
        const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8")) as {
            email?: unknown;
            sub?: unknown;
        };
        return {
            email: typeof decoded.email === "string" ? decoded.email : null,
            sub: typeof decoded.sub === "string" ? decoded.sub : null,
        };
    } catch {
        return { email: null, sub: null };
    }
}
