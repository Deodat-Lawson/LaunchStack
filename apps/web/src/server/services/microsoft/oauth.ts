/**
 * Microsoft identity platform (v2.0) authorization-code flow, as a thin typed
 * fetch wrapper: build the consent URL, exchange the code, refresh.
 *
 * Deliberately not MSAL: three requests, and every other service boundary in
 * this repo is a typed fetch wrapper. Credentials are passed in per call; the
 * host owns token storage.
 */
import { z } from "zod";

import { microsoftEndpoints, type MicrosoftOAuthApp } from "./config";

const DEFAULT_TIMEOUT_MS = 30_000;

const tokenResponseSchema = z.object({
    access_token: z.string().min(1),
    expires_in: z.coerce.number().positive(),
    /** Present when offline_access was granted. Microsoft rotates it on refresh. */
    refresh_token: z.string().min(1).optional(),
    scope: z.string().optional(),
    id_token: z.string().optional(),
    token_type: z.string().optional(),
});
export type MicrosoftTokenResponse = z.infer<typeof tokenResponseSchema>;

const oauthErrorSchema = z.object({
    error: z.string().optional(),
    error_description: z.string().optional(),
});

export class MicrosoftAuthError extends Error {
    readonly status: number;
    /** OAuth error code (`invalid_grant`, `invalid_client`, …) when Microsoft gave one. */
    readonly code: string | null;
    readonly detail: string;

    constructor(status: number, code: string | null, detail: string) {
        super(`Microsoft sign-in error (${status}): ${detail}`);
        this.name = "MicrosoftAuthError";
        this.status = status;
        this.code = code;
        this.detail = detail;
    }

    /**
     * The stored grant is gone: the person or an administrator revoked it,
     * the password changed, or the refresh token aged out (90 days unused).
     * `interaction_required` is the same from a background job's side:
     * nobody is there to interact. Reconnecting is the only fix.
     */
    get invalidGrant(): boolean {
        return this.code === "invalid_grant" || this.code === "interaction_required";
    }
}

async function requestToken(form: Record<string, string>): Promise<MicrosoftTokenResponse> {
    let res: Response;
    try {
        res = await fetch(microsoftEndpoints().tokenUrl, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams(form).toString(),
            signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
        });
    } catch (err) {
        throw new MicrosoftAuthError(0, null, err instanceof Error ? err.message : String(err));
    }

    if (!res.ok) {
        const parsed = oauthErrorSchema.safeParse(await res.json().catch(() => ({})));
        const code = parsed.success ? (parsed.data.error ?? null) : null;
        let detail = "token request failed";
        if (res.statusText) detail = res.statusText;
        if (parsed.success) {
            const described = parsed.data.error_description ?? parsed.data.error;
            if (described) detail = described;
        }
        throw new MicrosoftAuthError(res.status, code, detail);
    }
    return tokenResponseSchema.parse(await res.json());
}

/** Build the consent-screen URL for the authorization-code flow. */
export function buildMicrosoftAuthorizationUrl(params: {
    clientId: string;
    redirectUri: string;
    scopes: string[];
    state: string;
}): string {
    const search = new URLSearchParams({
        client_id: params.clientId,
        redirect_uri: params.redirectUri,
        response_type: "code",
        response_mode: "query",
        scope: params.scopes.join(" "),
        // Always ask which account: an admin connecting the firm's files and a
        // member connecting their mailbox are often signed in to more than one.
        prompt: "select_account",
        state: params.state,
    });
    return `${microsoftEndpoints().authorizeUrl}?${search.toString()}`;
}

export async function exchangeMicrosoftCode(params: {
    app: MicrosoftOAuthApp;
    code: string;
    redirectUri: string;
}): Promise<MicrosoftTokenResponse> {
    return requestToken({
        grant_type: "authorization_code",
        code: params.code,
        client_id: params.app.clientId,
        client_secret: params.app.clientSecret,
        redirect_uri: params.redirectUri,
    });
}

/** Mint a fresh access token from a stored refresh token. */
export async function refreshMicrosoftToken(params: {
    app: MicrosoftOAuthApp;
    refreshToken: string;
}): Promise<MicrosoftTokenResponse> {
    return requestToken({
        grant_type: "refresh_token",
        refresh_token: params.refreshToken,
        client_id: params.app.clientId,
        client_secret: params.app.clientSecret,
    });
}

export interface MicrosoftIdClaims {
    /** The account's object id: stable within its tenant. */
    oid?: string;
    /** The tenant the account belongs to. */
    tid?: string;
    sub?: string;
    email?: string;
    name?: string;
}

/**
 * Claims from the id_token issued alongside the code exchange. The token was
 * received directly from Microsoft's token endpoint over TLS, so the
 * signature is not re-verified here: this is a convenience decode, not an
 * authentication step. `email` falls back to `preferred_username`, which is
 * the sign-in address for work and school accounts.
 */
export function decodeMicrosoftIdToken(idToken: string): MicrosoftIdClaims {
    const segments = idToken.split(".");
    if (segments.length < 2 || !segments[1]) return {};
    try {
        const claims = JSON.parse(Buffer.from(segments[1], "base64url").toString("utf8")) as Record<
            string,
            unknown
        >;
        const text = (value: unknown) =>
            typeof value === "string" && value.length > 0 ? value : undefined;
        const preferred = text(claims.preferred_username);
        return {
            oid: text(claims.oid),
            tid: text(claims.tid),
            sub: text(claims.sub),
            email: text(claims.email) ?? (preferred?.includes("@") ? preferred : undefined),
            name: text(claims.name),
        };
    } catch {
        return {};
    }
}

/** The connection's stable identity at Microsoft: tenant + object id, else the pairwise `sub`. */
export function microsoftAccountId(claims: MicrosoftIdClaims): string | null {
    if (claims.oid) return claims.tid ? `${claims.tid}:${claims.oid}` : claims.oid;
    return claims.sub ?? claims.email ?? null;
}
