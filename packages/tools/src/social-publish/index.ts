/**
 * social-publish — one adapter per platform behind one registry.
 *
 * Extracted from packages/features/src/marketing-pipeline/publish.ts
 * (unification PR-6), shaped like the email-pipeline SendAdapter. What
 * changed at extraction time, deliberately: platform credentials are read in
 * config.ts only; Bluesky sessions and Reddit app tokens are cached instead
 * of re-authenticating per call (salvaged from the retired research
 * clients); hard character limits come from platform-profiles; and every
 * success carries the platform-native postId — the key the engagement
 * read-back loop needs.
 */

import type { MarketingPlatform } from "../platform-profiles";
import { blueskyAdapter } from "./adapters/bluesky";
import {
    getBlueskyCredentials,
    getLinkedInAccessToken,
    getRedditCredentials,
    getTwitterBearerToken,
} from "./config";
import { linkedinAdapter } from "./adapters/linkedin";
import { redditAdapter } from "./adapters/reddit";
import { xAdapter } from "./adapters/x";
import type { PublishAdapter, PublishRequest, PublishResult } from "./types";

export type { PublishAdapter, PublishRequest, PublishResult } from "./types";
export { resetBlueskySession } from "./adapters/bluesky";
export { resetRedditToken } from "./adapters/reddit";

export const PUBLISH_ADAPTERS: Record<MarketingPlatform, PublishAdapter> = {
    x: xAdapter,
    bluesky: blueskyAdapter,
    reddit: redditAdapter,
    linkedin: linkedinAdapter,
};

export async function publishToPlatform(request: PublishRequest): Promise<PublishResult> {
    return PUBLISH_ADAPTERS[request.platform].publish(request);
}

/**
 * Compatibility signature for the original marketing publishContent(platform,
 * message, title?). New code should call publishToPlatform.
 */
export async function publishContent(
    platform: MarketingPlatform,
    message: string,
    title?: string
): Promise<PublishResult> {
    return publishToPlatform({ platform, message, title });
}

export interface PublishConfigState {
    /** The deployment holds credentials for this network. */
    configured: boolean;
    /** The account those credentials name, when the credential itself says (a Bluesky handle). */
    identity: string | null;
}

/**
 * Which networks this deployment can publish to. Reports presence only; no
 * credential ever leaves config.ts.
 */
export function describePublishConfig(): Record<MarketingPlatform, PublishConfigState> {
    const bluesky = getBlueskyCredentials();
    return {
        x: { configured: Boolean(getTwitterBearerToken()), identity: null },
        linkedin: { configured: Boolean(getLinkedInAccessToken()), identity: null },
        bluesky: { configured: bluesky !== null, identity: bluesky?.handle ?? null },
        reddit: { configured: getRedditCredentials() !== null, identity: null },
    };
}
