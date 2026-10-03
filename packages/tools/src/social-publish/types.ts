import type { MarketingPlatform } from "../platform-profiles";

/** An image to attach, already read into memory by the host. */
export interface PublishMedia {
    data: Uint8Array;
    /** image/jpeg, image/png, image/gif or image/webp. */
    mimeType: string;
    /** Alt text; networks that take it (both LinkedIn and Bluesky) get it. */
    alt?: string;
    filename?: string;
}

/**
 * Who a post goes out as, when a workspace connected its own account. Absent,
 * an adapter falls back to the deployment's env credentials (the behaviour
 * before per-workspace channels existed).
 */
export interface LinkedInTarget {
    kind: "linkedin";
    accessToken: string;
    /** `urn:li:person:<id>` for a member, `urn:li:organization:<id>` for a Page. */
    authorUrn: string;
}

export interface BlueskyTarget {
    kind: "bluesky";
    /** Handle or DID. */
    identifier: string;
    appPassword: string;
    /** PDS base URL; defaults to BLUESKY_SERVICE_URL or https://bsky.social. */
    service?: string;
}

export type PublishTarget = LinkedInTarget | BlueskyTarget;

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
    /** The workspace account to post as; absent → the deployment's env credentials. */
    target?: PublishTarget;
    /** Images to attach. Adapters for networks without media support ignore them. */
    media?: PublishMedia[];
}

export interface PublishResult {
    success: boolean;
    platform: MarketingPlatform;
    /** Public URL of the created post, when the platform reports one. */
    postUrl?: string;
    /** Platform-native id/URN of the created post — the engagement read-back key. */
    postId?: string;
    error?: string;
    /** The network refused the credential itself (expired, revoked): reconnect, don't retry. */
    authFailed?: boolean;
    /** Worth trying again later: rate limited, 5xx or a network failure. */
    retryable?: boolean;
}

/** One platform integration (the email-pipeline SendAdapter shape). */
export interface PublishAdapter {
    platform: MarketingPlatform;
    publish(request: PublishRequest): Promise<PublishResult>;
}
