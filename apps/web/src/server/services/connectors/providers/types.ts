/**
 * The wire shapes every provider module implements. Pure functions over an
 * injected `fetch`: the host owns env, token storage, and the state
 * parameter; a provider module owns its endpoints and response parsing.
 */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ProviderOAuthConfig {
    readonly clientId: string;
    readonly clientSecret: string;
    readonly redirectUri: string;
    readonly fetch?: FetchLike;
}

/** What a code exchange must resolve to, regardless of provider. */
export interface ProviderGrant {
    /** Stable id of what was connected: Google sub, Slack team_id, GitHub user id. */
    readonly providerAccountId: string;
    /** Google email, Slack team name, GitHub login. */
    readonly displayName: string | null;
    /** Space-delimited, exactly as granted. */
    readonly scopes: string;
    readonly accessToken: string;
    /** Null when the provider issues non-expiring tokens. */
    readonly accessTokenExpiresAt: Date | null;
    /** Null when the provider issued no refresh token. */
    readonly refreshToken: string | null;
}

export interface RefreshedProviderToken {
    readonly accessToken: string;
    readonly accessTokenExpiresAt: Date | null;
    /** Set when the provider rotates refresh tokens on use (GitHub, Slack). */
    readonly refreshToken: string | null;
}

/** The grant is dead at the provider (revoked / expired): reconnect. */
export class ConnectorGrantRevokedError extends Error {
    constructor(provider: string) {
        super(`${provider} grant is no longer valid — reconnect required`);
        this.name = "ConnectorGrantRevokedError";
    }
}

export class ConnectorOAuthError extends Error {
    constructor(
        message: string,
        readonly status?: number
    ) {
        super(message);
        this.name = "ConnectorOAuthError";
    }
}

export async function postForm(
    fetchImpl: FetchLike,
    url: string,
    body: Record<string, string>,
    headers: Record<string, string> = {}
): Promise<Response> {
    return fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers },
        body: new URLSearchParams(body).toString(),
    });
}

export async function readTokenError(response: Response): Promise<string> {
    try {
        const payload = (await response.json()) as { error?: string; error_description?: string };
        return payload.error_description ?? payload.error ?? `HTTP ${response.status}`;
    } catch {
        return `HTTP ${response.status}`;
    }
}
