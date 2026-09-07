import type { MarketingPlatform } from "../platform-profiles";

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
}

export interface PublishResult {
    success: boolean;
    platform: MarketingPlatform;
    /** Public URL of the created post, when the platform reports one. */
    postUrl?: string;
    /** Platform-native id/URN of the created post — the engagement read-back key. */
    postId?: string;
    error?: string;
}

/** One platform integration (the email-pipeline SendAdapter shape). */
export interface PublishAdapter {
    platform: MarketingPlatform;
    publish(request: PublishRequest): Promise<PublishResult>;
}
