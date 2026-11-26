import { describe, expect, it } from "vitest";
import {
    CampaignPlatformEnum,
    DraftOnlyPlatformEnum,
    getPlatformProfile,
    isPublishPlatform,
    MarketingPlatformEnum,
    PLATFORM_PROFILES,
    platformNormsReference,
    REFERENCE_POSTS,
} from "@launchstack/tools/platform-profiles";
import { PUBLISH_ADAPTERS } from "@launchstack/tools/social-publish";

describe("PLATFORM_PROFILES", () => {
    it("covers every platform the generator writes for, and nothing else", () => {
        for (const platform of CampaignPlatformEnum.options) {
            expect(PLATFORM_PROFILES[platform].id).toBe(platform);
        }
        expect(Object.keys(PLATFORM_PROFILES).sort()).toEqual(
            [...CampaignPlatformEnum.options].sort()
        );
    });

    it("the original four are named by their id in prompts, as before", () => {
        for (const platform of MarketingPlatformEnum.options) {
            const profile = getPlatformProfile(platform);
            expect(profile.promptName).toBe(platform);
            expect(profile.formatRules).toBeUndefined();
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

describe("the two vocabularies", () => {
    it("the campaign vocabulary is the four Brand posts to, then the draft-only ones", () => {
        expect(CampaignPlatformEnum.options).toEqual([
            ...MarketingPlatformEnum.options,
            ...DraftOnlyPlatformEnum.options,
        ]);
        expect(DraftOnlyPlatformEnum.options).toEqual([
            "instagram",
            "threads",
            "facebook",
            "tiktok",
            "youtube",
            "mastodon",
            "hackernews",
            "producthunt",
            "discord",
        ]);
    });

    it("only the four have a publish adapter: a draft-only network cannot be posted to", () => {
        expect(Object.keys(PUBLISH_ADAPTERS).sort()).toEqual(
            [...MarketingPlatformEnum.options].sort()
        );
        for (const platform of DraftOnlyPlatformEnum.options) {
            expect(isPublishPlatform(platform)).toBe(false);
            expect(MarketingPlatformEnum.safeParse(platform).success).toBe(false);
        }
        for (const platform of MarketingPlatformEnum.options) {
            expect(isPublishPlatform(platform)).toBe(true);
        }
        expect(isPublishPlatform("myspace")).toBe(false);
    });
});

describe("draft-only profiles", () => {
    it.each(DraftOnlyPlatformEnum.options)("%s has everything the generator reads", platform => {
        const profile = getPlatformProfile(platform);
        // A real name: prompts and trend searches say "Hacker News", not "hackernews".
        expect(profile.promptName).not.toBe(platform);
        expect(profile.promptName).toMatch(/^[A-Z]/);
        expect(profile.structureTemplate).toContain(`Platform: ${profile.promptName}`);
        expect(profile.structureTemplate).toContain("Tone:");
        expect(profile.guidelines().split("\n").length).toBeGreaterThanOrEqual(4);
        expect(profile.examples).toContain("for style reference only");
        // No curated judge references yet; the judge gets the norms instead.
        expect(profile.referencePosts).toBeNull();
        expect(platformNormsReference(platform)).toContain(profile.structureTemplate);
    });

    it("carries each network's documented limits", () => {
        expect(PLATFORM_PROFILES.instagram.hardCharLimit).toBe(2200);
        expect(PLATFORM_PROFILES.threads.hardCharLimit).toBe(500);
        expect(PLATFORM_PROFILES.mastodon.hardCharLimit).toBe(500);
        expect(PLATFORM_PROFILES.discord.hardCharLimit).toBe(2000);
        // One topic tag a post on Threads; hashtags are how Mastodon is searched.
        expect(PLATFORM_PROFILES.threads.maxHashtags).toBe(1);
        expect(PLATFORM_PROFILES.mastodon.maxHashtags).toBe(4);
        expect(PLATFORM_PROFILES.instagram.maxHashtags).toBe(5);
        for (const platform of ["hackernews", "producthunt", "discord"] as const) {
            expect(PLATFORM_PROFILES[platform].maxHashtags).toBe(0);
        }
        // The parts' own limits are in the template the generator is shown.
        expect(PLATFORM_PROFILES.hackernews.structureTemplate).toContain("under 80 characters");
        expect(PLATFORM_PROFILES.producthunt.structureTemplate).toContain("under 60 characters");
        expect(PLATFORM_PROFILES.producthunt.structureTemplate).toContain("under 260 characters");
        expect(PLATFORM_PROFILES.youtube.structureTemplate).toContain("the limit is 100");
    });

    it("a post made of labelled parts says so, and has no single limit", () => {
        const labelled = {
            tiktok: ["HOOK", "SCRIPT", "ON-SCREEN TEXT", "CAPTION"],
            youtube: ["TITLE", "HOOK", "OUTLINE", "DESCRIPTION"],
            hackernews: ["TITLE", "TEXT"],
            producthunt: ["TAGLINE", "DESCRIPTION", "FIRST COMMENT"],
        } as const;
        for (const [platform, parts] of Object.entries(labelled)) {
            const profile = getPlatformProfile(platform as keyof typeof labelled);
            expect(profile.formatRules?.length).toBeGreaterThan(0);
            expect(profile.hardCharLimit).toBeNull();
            for (const part of parts) {
                expect(profile.structureTemplate).toContain(`- ${part}`);
                // The example shows the same parts, the way the draft should come back.
                expect(profile.examples).toContain(`**${part}`);
            }
        }
    });

    it("an example never breaks its own network's limits", () => {
        const exampleBody = (examples: string) => /"""\n([\s\S]*?)\n"""/.exec(examples)![1]!;
        for (const platform of DraftOnlyPlatformEnum.options) {
            const profile = getPlatformProfile(platform);
            const body = exampleBody(profile.examples);
            if (profile.hardCharLimit !== null) {
                expect(Array.from(body).length).toBeLessThanOrEqual(profile.hardCharLimit);
            }
            const hashtags = body.match(/(^|\s)#[A-Za-z]\w*/g) ?? [];
            expect(hashtags.length).toBeLessThanOrEqual(profile.maxHashtags);
        }
        const line = (platform: "hackernews" | "producthunt" | "youtube", label: string) =>
            new RegExp(`\\*\\*${label}:\\*\\* (.*)`).exec(
                exampleBody(getPlatformProfile(platform).examples)
            )![1]!;
        expect(line("hackernews", "TITLE").length).toBeLessThanOrEqual(80);
        expect(line("producthunt", "TAGLINE").length).toBeLessThanOrEqual(60);
        expect(line("producthunt", "DESCRIPTION").length).toBeLessThanOrEqual(260);
        expect(line("youtube", "TITLE").length).toBeLessThanOrEqual(70);
    });
});
