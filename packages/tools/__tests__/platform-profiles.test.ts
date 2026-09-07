import { describe, expect, it } from "vitest";
import {
    getPlatformProfile,
    MarketingPlatformEnum,
    PLATFORM_PROFILES,
    REFERENCE_POSTS,
} from "@launchstack/tools/platform-profiles";

describe("PLATFORM_PROFILES", () => {
    it("covers every platform in the enum", () => {
        for (const platform of MarketingPlatformEnum.options) {
            expect(PLATFORM_PROFILES[platform].id).toBe(platform);
        }
    });

    it("freezes the pre-extraction constants", () => {
        expect(PLATFORM_PROFILES.x.hardCharLimit).toBe(280);
        expect(PLATFORM_PROFILES.bluesky.hardCharLimit).toBe(300);
        expect(PLATFORM_PROFILES.linkedin.hardCharLimit).toBeNull();
        expect(PLATFORM_PROFILES.linkedin.maxHashtags).toBe(3);
        expect(PLATFORM_PROFILES.x.maxHashtags).toBe(2);
        expect(PLATFORM_PROFILES.reddit.maxHashtags).toBe(0);
    });

    it("reddit guidelines include the subreddit block only when given", () => {
        const plain = getPlatformProfile("reddit").guidelines();
        const scoped = getPlatformProfile("reddit").guidelines({ subreddit: "r/startups" });
        expect(plain).not.toContain("Target subreddit");
        expect(scoped).toContain("Target subreddit: r/startups");
    });

    it("ships non-empty judge references for the curated platforms", () => {
        expect(REFERENCE_POSTS.x.length).toBeGreaterThan(500);
        expect(REFERENCE_POSTS.linkedin.length).toBeGreaterThan(500);
        expect(REFERENCE_POSTS.reddit.length).toBeGreaterThan(500);
        expect(PLATFORM_PROFILES.bluesky.referencePosts).toBeNull();
    });
});
