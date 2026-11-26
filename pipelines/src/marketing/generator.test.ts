/**
 * What the generator is told about the network it writes for. The original
 * four's prompts are frozen (named by id, no extra rules); a draft-only
 * network is named properly, and one whose post is labelled parts (a script,
 * a launch page) has its format rules put last, where they win.
 */
import type { HumanMessage } from "@langchain/core/messages";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./models", () => ({ invokeMarketingStructured: vi.fn() }));

import { generateVariants, refineContent } from "./generator";
import { invokeMarketingStructured } from "./models";
import type { CampaignPlatform, StrategyVariant } from "./types";

const mockInvoke = vi.mocked(invokeMarketingStructured);

const STRATEGY: StrategyVariant = {
    variantId: "v1",
    angleRationale: "why",
    angle: "Prep in two days, not two weeks",
    keyProof: ["Four people ship four times the campaigns"],
    humanHook: "We deleted our content calendar",
    avoidList: ["revolutionary"],
};

/** The human turn of the one generation call. */
function shown(): string {
    const [, messages] = mockInvoke.mock.calls[0]!;
    return (messages[1] as HumanMessage).content as string;
}

async function generateFor(platform: CampaignPlatform): Promise<string> {
    await generateVariants({
        platform,
        prompt: "Announce claim checking",
        companyContext: "Acme makes campaign tools.",
        research: [],
        strategies: [STRATEGY],
    });
    return shown();
}

beforeEach(() => {
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue({
        platform: "x",
        message: "A post.",
        "image/video": "image",
        feedbackApplied: "Shortened it.",
    } as never);
});

describe("the generation prompt", () => {
    it("names the original four by id and adds nothing to their task", async () => {
        for (const platform of ["x", "linkedin", "reddit", "bluesky"] as const) {
            mockInvoke.mockClear();
            const prompt = await generateFor(platform);
            expect(prompt).toContain(`Selected platform: ${platform}\n`);
            expect(prompt).not.toContain("format rules win");
            expect(prompt).not.toContain('Set "platform"');
        }
    });

    it("names a draft-only network properly and says which id to return", async () => {
        const prompt = await generateFor("instagram");
        expect(prompt).toContain("Selected platform: Instagram\n");
        expect(prompt).toContain("Platform: Instagram (caption for a feed post or Reel)");
        expect(prompt).toContain("- Use at most 5 hashtags.");
        expect(prompt).toContain('- Set "platform" to "instagram".');
        // A caption is one post: the generic rules stand.
        expect(prompt).not.toContain("format rules win");
    });

    it.each(["tiktok", "youtube", "hackernews", "producthunt", "discord"] as const)(
        "puts %s's format rules last, where they win over the one-post rules",
        async platform => {
            const prompt = await generateFor(platform);
            const rules = prompt.indexOf("This platform's format rules win over any rule above");
            expect(rules).toBeGreaterThan(prompt.indexOf("- End with exactly ONE question or CTA"));
            expect(rules).toBeGreaterThan(prompt.indexOf("- NEVER list features as bullet points"));
            expect(prompt.indexOf("- Return JSON matching the schema exactly.")).toBeGreaterThan(
                rules
            );
        }
    );

    it("asks TikTok for a script and Hacker News for a plain submission", async () => {
        const tiktok = await generateFor("tiktok");
        expect(tiktok).toContain("HOOK (0–3s)");
        expect(tiktok).toContain("Write a short video script");
        expect(tiktok).toContain('Set "image/video" to "video".');

        mockInvoke.mockClear();
        const hn = await generateFor("hackernews");
        expect(hn).toContain("Selected platform: Hacker News\n");
        expect(hn).toContain("Start with “Show HN: ”");
        expect(hn).toContain("No hook, no scroll-stopping first line and no call to action");
        expect(hn).toContain("- Use at most 0 hashtags.");
    });
});

describe("refinement keeps the format", () => {
    const refine = (platform: CampaignPlatform) =>
        refineContent({
            platform,
            originalMessage: "**TITLE:** A title",
            feedback: "Shorter",
            companyContext: "Acme makes campaign tools.",
        });

    it("shows a labelled-parts network its parts again", async () => {
        await refine("youtube");
        expect(shown()).toContain("Platform: YouTube\n");
        expect(shown()).toContain("Keep this platform's format:");
        expect(shown()).toContain("- OUTLINE: 3–5 numbered sections");
    });

    it("leaves the original four's refinement as it was", async () => {
        await refine("linkedin");
        expect(shown()).toContain("Platform: linkedin\n");
        expect(shown()).not.toContain("Keep this platform's format");
    });
});
