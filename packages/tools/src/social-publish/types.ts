import type { MarketingPlatform } from "../platform-profiles";

/**
 * Per-workspace network credentials, supplied by the caller. When present on
 * a PublishRequest they take precedence over the deployment-wide env
 * fallback in config.ts, so two workspaces on one deployment post to their
 * own accounts.
 */
export type SocialCredentials =
    | { platform: "x"; bearerToken: string }
    | { platform: "linkedin"; accessToken: string }
    | { platform: "bluesky"; handle: string; appPassword: string }
    | { platform: "reddit"; clientId: string; clientSecret: string; userAgent: string };

export interface PublishRequest {
    platform: MarketingPlatform;
    message: string;
    /** Reddit self-post title; derived from the first line when omitted. */
    title?: string;
    /**
     * Reserved for callers that must not double-post (the email SendAdapter
     * precedent). None of the current platform APIs accept one natively, so
     * adapters ignore it today; the field keeps the contract stable for a
     * store-backed idempotency layer.
     */
    idempotencyKey?: string;
    /**
     * The workspace's own credentials for `platform`. Must match `platform`
     * (a mismatch is a failed result, never a silent env fallback). Absent →
     * the deployment-wide env credentials from config.ts.
     */
    credentials?: SocialCredentials;
    /** Test seam; defaults to the global fetch. */
    fetchImpl?: typeof fetch;
}

export interface PublishResult {
    success: boolean;
    platform: MarketingPlatform;
    /** Public URL of the created post, when the platform reports one. */
    postUrl?: string;
    /** Platform-native id/URN of the created post — the engagement read-back key. */
    postId?: string;
    error?: string;
    /** HTTP status from the network, when the failure came back as one. */
    status?: number;
    /** True for 429, 5xx, and network errors/timeouts — worth another attempt. */
    retryable?: boolean;
    /** True for 401/403 or an auth/session failure — the credential needs attention. */
    authFailed?: boolean;
}

export type VerifyResult =
    | { ok: true; identity: string | null }
    | { ok: false; error: string; authFailed?: boolean; retryable?: boolean };

/** One platform integration (the email-pipeline SendAdapter shape). */
export interface PublishAdapter {
    platform: MarketingPlatform;
    publish(request: PublishRequest): Promise<PublishResult>;
    /** Check a credential against the network without posting; reports the account it names when the network says. */
    verify(
        credentials: SocialCredentials,
        options?: { fetchImpl?: typeof fetch }
    ): Promise<VerifyResult>;
}
