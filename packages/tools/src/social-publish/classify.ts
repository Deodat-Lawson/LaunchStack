/**
 * Shared failure classification for the social-publish adapters, so every
 * network reports `status` / `retryable` / `authFailed` by the same rules:
 *
 *   retryable  — 429, 5xx, and network errors/timeouts
 *   authFailed — 401/403, or any non-retryable failure of an auth step
 *                (Bluesky createSession, Reddit access_token)
 */

import type { MarketingPlatform } from "../platform-profiles";
import type { PublishResult, SocialCredentials, VerifyResult } from "./types";

/**
 * An HTTP failure thrown from inside an adapter's auth step, so the publish
 * catch can classify it instead of collapsing it into a generic error.
 */
export class SocialHttpError extends Error {
    readonly status: number;
    /** Thrown while establishing a session/token, not while posting. */
    readonly authStep: boolean;

    constructor(status: number, message: string, options: { authStep?: boolean } = {}) {
        super(message);
        this.name = "SocialHttpError";
        this.status = status;
        this.authStep = options.authStep ?? false;
    }
}

export function isRetryableStatus(status: number): boolean {
    return status === 429 || status >= 500;
}

export function isAuthStatus(status: number): boolean {
    return status === 401 || status === 403;
}

/** Flags for an HTTP status from a posting call. */
export function classifyStatus(status: number): {
    status: number;
    retryable: boolean;
    authFailed: boolean;
} {
    return { status, retryable: isRetryableStatus(status), authFailed: isAuthStatus(status) };
}

/**
 * Flags for an HTTP status from an auth step: whatever the network will not
 * retry is a credential problem (bad password, revoked app, wrong scopes).
 */
export function classifyAuthStatus(status: number): {
    status: number;
    retryable: boolean;
    authFailed: boolean;
} {
    const retryable = isRetryableStatus(status);
    return { status, retryable, authFailed: !retryable };
}

export function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : "Unknown error";
}

/** The request carried credentials for a different network than the adapter. */
export function credentialMismatch(
    expected: MarketingPlatform,
    credentials: SocialCredentials | undefined
): PublishResult | null {
    if (!credentials || credentials.platform === expected) return null;
    return {
        success: false,
        platform: expected,
        error: `Credentials are for ${credentials.platform}, not ${expected}`,
        retryable: false,
        authFailed: false,
    };
}

/** Neither the request nor the environment supplied a credential. */
export function notConfigured(platform: MarketingPlatform, error: string): PublishResult {
    return { success: false, platform, error, retryable: false, authFailed: false };
}

/** A posting call came back with a non-2xx status. */
export function httpFailure(
    platform: MarketingPlatform,
    status: number,
    error: string
): PublishResult {
    return { success: false, platform, error, ...classifyStatus(status) };
}

/** A network error, timeout, or a SocialHttpError thrown by an auth step. */
export function thrownFailure(platform: MarketingPlatform, err: unknown): PublishResult {
    if (err instanceof SocialHttpError) {
        const flags = err.authStep ? classifyAuthStatus(err.status) : classifyStatus(err.status);
        return { success: false, platform, error: err.message, ...flags };
    }
    return {
        success: false,
        platform,
        error: errorMessage(err),
        retryable: true,
        authFailed: false,
    };
}

/** VerifyResult for a non-2xx status from a verification call. */
export function verifyHttpFailure(status: number, error: string): VerifyResult {
    const flags = classifyStatus(status);
    return { ok: false, error, retryable: flags.retryable, authFailed: flags.authFailed };
}

/** VerifyResult for a network error, timeout, or auth-step SocialHttpError. */
export function verifyThrownFailure(err: unknown): VerifyResult {
    if (err instanceof SocialHttpError) {
        const flags = err.authStep ? classifyAuthStatus(err.status) : classifyStatus(err.status);
        return {
            ok: false,
            error: err.message,
            retryable: flags.retryable,
            authFailed: flags.authFailed,
        };
    }
    return { ok: false, error: errorMessage(err), retryable: true, authFailed: false };
}

/** VerifyResult when the credential is for a different network than the adapter. */
export function verifyMismatch(
    expected: MarketingPlatform,
    credentials: SocialCredentials
): VerifyResult {
    return {
        ok: false,
        error: `Credentials are for ${credentials.platform}, not ${expected}`,
        retryable: false,
        authFailed: false,
    };
}

/** Drop expired entries so a per-identity cache cannot grow without bound. */
export function pruneExpired<K>(cache: Map<K, { expiresAt: number }>, now = Date.now()): void {
    for (const [key, entry] of cache) {
        if (entry.expiresAt <= now) cache.delete(key);
    }
}

/** Trim a response body for an error message. */
export async function bodyText(response: Response, max = 500): Promise<string> {
    try {
        const text = (await response.text()).trim();
        return text.length > max ? `${text.slice(0, max)}…` : text;
    } catch {
        return "";
    }
}
