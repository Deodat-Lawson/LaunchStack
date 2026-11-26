/** @jest-environment jsdom */

/**
 * The picker's networks, held to the generator's. The screen keeps its own
 * list (a client bundle should not pull in the profiles' prompt text), so
 * nothing but this test stops the two drifting: a network the generator
 * writes for and the picker never offers, a card with no words in one
 * language, a hashtag field that allows more than the generator will use.
 */
import {
    CampaignPlatformEnum,
    getPlatformProfile,
    isPublishPlatform as serverIsPublishPlatform,
} from "@launchstack/tools/platform-profiles";

import {
    PLATFORM_OPTIONS,
    PROMPT_TEMPLATE_KEYS,
    isPublishPlatform,
    rendersMarkdown,
} from "~/app/employer/documents/components/marketing-pipeline/shared";
import { toPlatformText } from "~/app/employer/documents/components/marketing-pipeline/useMarketingPipelineController";
import { NETWORK_MARKS } from "~/components/icons/brand";
import en from "~/i18n/messages/en/growth.json";
import zh from "~/i18n/messages/zh-CN/growth.json";

type Card = {
    subtitle: string;
    bestFor: string;
    charLimit: string;
    placeholder: string;
    templates: Record<string, string>;
};
const cards = (catalogue: typeof en) =>
    catalogue.marketingPipeline.platforms as unknown as Record<string, Card | undefined>;

const ids = PLATFORM_OPTIONS.map(option => option.id);

it("offers every network the generator writes for, the four Brand posts to first", () => {
    expect([...ids].sort()).toEqual([...CampaignPlatformEnum.options].sort());
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids.slice(0, 4)].sort()).toEqual(["bluesky", "linkedin", "reddit", "x"]);
});

it("agrees with the server on which networks are copy-only", () => {
    for (const id of ids) expect(isPublishPlatform(id)).toBe(serverIsPublishPlatform(id));
    expect(ids.filter(id => !isPublishPlatform(id))).toEqual([
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
    expect(isPublishPlatform(null)).toBe(false);
});

it.each(ids)("%s has a logo and a full card in English and Chinese", id => {
    expect(NETWORK_MARKS[id].Mark).toEqual(expect.any(Function));
    expect(NETWORK_MARKS[id].fill).toBeGreaterThan(0.4);
    expect(NETWORK_MARKS[id].fill).toBeLessThanOrEqual(1);
    for (const catalogue of [en, zh as typeof en]) {
        const card = cards(catalogue)[id];
        expect(card).toBeDefined();
        for (const key of ["subtitle", "bestFor", "charLimit", "placeholder"] as const) {
            expect(card![key].trim().length).toBeGreaterThan(0);
        }
        expect(Object.keys(card!.templates)).toEqual([...PROMPT_TEMPLATE_KEYS]);
    }
    // Translated, not copied across.
    expect(cards(zh as typeof en)[id]!.subtitle).not.toBe(cards(en)[id]!.subtitle);
});

it("has no card for a network the picker does not offer", () => {
    expect(Object.keys(cards(en)).sort()).toEqual([...ids].sort());
    expect(Object.keys(cards(zh as typeof en)).sort()).toEqual([...ids].sort());
});

it("a copy-only network's hashtag field allows what the generator will use, no more", () => {
    for (const option of PLATFORM_OPTIONS.filter(o => !isPublishPlatform(o.id))) {
        const cap = getPlatformProfile(option.id).maxHashtags;
        const field = option.platformFields?.find(f => f.type === "hashtags");
        if (cap === 0) {
            expect(field).toBeUndefined();
        } else {
            expect(field?.maxItems).toBe(cap);
            for (const tag of field!.suggestions) expect(tag).toMatch(/^#[A-Z]\w+$/);
        }
    }
});

it("copies Markdown only to the networks that render it", () => {
    const draft = "**Claim checking is live**\n\n- one\n- two";
    expect(ids.filter(id => rendersMarkdown(id))).toEqual(["reddit", "discord"]);
    expect(toPlatformText("discord", draft)).toBe(draft);
    expect(toPlatformText("reddit", draft)).toBe(draft);
    // A script's bold labels would post as asterisks anywhere else.
    expect(toPlatformText("tiktok", "**HOOK (0–3s):** Stop scrolling.")).toBe(
        "HOOK (0–3s): Stop scrolling."
    );
    expect(toPlatformText("hackernews", "**TITLE:** Show HN: Acme – a thing")).toBe(
        "TITLE: Show HN: Acme – a thing"
    );
});
