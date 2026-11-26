/**
 * The Campaign Planner eval contract mirrors the generator's networks by
 * hand (it is a frozen contract file, not an import). This holds the mirror
 * to the profiles: the same networks, and for the copy-only ones the same
 * hashtag caps and character limits the generator is told.
 */
import {
    CampaignPlatformEnum,
    DraftOnlyPlatformEnum,
    getPlatformProfile,
} from "@launchstack/tools/platform-profiles";

import { platformCharLimit } from "~/lib/agents/evals/campaign/assertions";
import {
    PLATFORM_CHAR_LIMITS,
    PLATFORM_HASHTAG_LIMITS,
    PlatformEnum,
} from "~/lib/agents/evals/campaign/contract";

it("targets the same networks as the generator, in the same order", () => {
    expect(PlatformEnum.options).toEqual(CampaignPlatformEnum.options);
});

it.each(DraftOnlyPlatformEnum.options)("%s: limits match its profile", platform => {
    const profile = getPlatformProfile(platform);
    expect(PLATFORM_HASHTAG_LIMITS[platform]).toBe(profile.maxHashtags);
    if (profile.hardCharLimit !== null) {
        expect(PLATFORM_CHAR_LIMITS[platform]).toBe(profile.hardCharLimit);
    }
    // A post in labelled parts has no single number to hold it to.
    if (profile.formatRules && profile.hardCharLimit === null) {
        expect(PLATFORM_CHAR_LIMITS[platform]).toBeNull();
    }
});

it("the character check skips a network with no single limit, and holds the rest", () => {
    const long = "word ".repeat(700); // 3,500 characters
    const check = (platform: (typeof PlatformEnum.options)[number]) =>
        platformCharLimit.run(
            { platform, variants: [{ message: long }] } as never,
            {} as never,
            {}
        );
    expect(check("tiktok")).toMatchObject({ passed: true });
    expect(check("hackernews")).toMatchObject({ passed: true });
    expect(check("instagram")).toMatchObject({ passed: false });
    expect(check("threads")).toMatchObject({ passed: false });
});
