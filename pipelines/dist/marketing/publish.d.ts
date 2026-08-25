/**
 * Marketing content publisher — sends generated content to platform APIs.
 * Currently supports Twitter/X, Reddit, LinkedIn, and Bluesky.
 *
 * Each publisher is behind an env-var gate so missing credentials
 * gracefully return an error instead of crashing.
 */
import type { MarketingPlatform } from "./types.js";
export type PublishResult = {
    success: boolean;
    platform: MarketingPlatform;
    postUrl?: string;
    error?: string;
};
/**
 * Publish generated marketing content to the specified platform.
 * Returns a result object indicating success/failure with optional post URL.
 */
export declare function publishContent(platform: MarketingPlatform, message: string, title?: string): Promise<PublishResult>;
//# sourceMappingURL=publish.d.ts.map