/**
 * A campaign's two web-research stages search on the company's own name, so
 * they find unrelated companies and products that are merely called the same
 * thing. Those pages used to come back as facts about us: a real "Harbor" app
 * as "essential product context", a real "LaunchStack" boilerplate's stack
 * under `ourAdvantages`. Both became `keyProof` and were written as fact.
 *
 * The whole pipeline runs here with its real stages; only the edges are
 * replaced (the models, the search, the database). The tests look at what
 * each model is shown, because that is what decides what it can write:
 *
 * - a result the synthesizer calls a namesake, or takes to be us, reaches
 *   neither the strategist nor the generator;
 * - one that slips through as "market" sits only where it is labelled as the
 *   outside world;
 * - nothing from the web, and no earlier angle, ever sits under ABOUT US,
 *   the one band a proof point may be drawn from.
 */
import type { BaseMessageLike, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@launchstack/llm", async importOriginal => ({
    ...(await importOriginal<object>()),
    resolveChatModel: vi.fn(() => ({})),
    // The trend synthesizer's model.
    invokeStructured: vi.fn(),
}));
// The analyst's, the strategist's and the generator's model.
vi.mock("./models", () => ({ invokeMarketingStructured: vi.fn() }));
vi.mock("@launchstack/tools/web-research", async importOriginal => ({
    ...(await importOriginal<object>()),
    configuredWebSearchProvider: vi.fn(() => "exa"),
    searchWeb: vi.fn(),
    executeSearch: vi.fn(),
}));
vi.mock("@launchstack/pipelines/trend-search/cache", () => ({
    getCachedTrendSearch: vi.fn(() => null),
    setCachedTrendSearch: vi.fn(),
}));
vi.mock("@launchstack/tools/company-context", async importOriginal => ({
    ...(await importOriginal<object>()),
    getCompanyIdentity: vi.fn(),
    buildCompanyKnowledgeContext: vi.fn(),
    extractCompanyDNA: vi.fn(),
}));
vi.mock("@launchstack/tools/brand-voice", async importOriginal => ({
    ...(await importOriginal<object>()),
    extractBrandVoice: vi.fn(async () => ({
        toneDescriptor: "plain",
        formalityLevel: "casual",
        sentenceStyle: "short",
        vocabularyExamples: [],
    })),
}));
vi.mock("@launchstack/tools/claim-evidence", async importOriginal => ({
    ...(await importOriginal<object>()),
    checkClaimSources: vi.fn(async () => ({ claims: [], totalClaimsFound: 0 })),
}));
vi.mock("./performance", async importOriginal => ({
    ...(await importOriginal<object>()),
    getPerformanceHistory: vi.fn(),
    saveGeneratedContent: vi.fn(async () => undefined),
}));

import { invokeStructured } from "@launchstack/llm";
import { getCachedTrendSearch } from "@launchstack/pipelines/trend-search/cache";
import {
    buildCompanyKnowledgeContext,
    extractCompanyDNA,
    getCompanyIdentity,
} from "@launchstack/tools/company-context";
import { executeSearch, searchWeb } from "@launchstack/tools/web-research";

import { invokeMarketingStructured } from "./models";
import { getPerformanceHistory } from "./performance";
import { ABOUT_US_HEADING, EARLIER_POSTS_HEADING, OUTSIDE_WORLD_HEADING } from "./positioning";
import { researchPlatformTrends } from "./research";
import { runMarketingPipeline } from "./run";

const mockSynthesizer = vi.mocked(invokeStructured);
const mockModel = vi.mocked(invokeMarketingStructured);

/* ── What is true of us (the workspace's documents) ──────────────────────── */

const IDENTITY = {
    name: "LaunchStack Dev",
    description: "Makes Harbor, a workspace that answers questions from a startup's own documents.",
    industry: "Software",
    numberOfEmployees: null,
    categories: ["documents"],
};
const DNA = {
    coreMission: "Harbor answers a startup's questions from its own documents.",
    keyDifferentiators: ["every answer cites the page it came from"],
    provenResults: ["halved onboarding questions on our own team"],
    humanStory: "Not specified",
    technicalEdge: "It reads the files a team already has.",
};
const KNOWLEDGE =
    "Company Name: LaunchStack Dev\nKnowledge Base Signals: 1. Harbor cites the page behind every answer.";

/* ── What the web says about things called the same ──────────────────────── */

/** Only in the trend hit about the real, unrelated app called Harbor. */
const NAMESAKE_TREND = "private local AI inference servers";
/** Only in the competitor hit about the real, unrelated LaunchStack boilerplate. */
const NAMESAKE_STACK = "Fastify, TypeScript, Prisma, and PostgreSQL";
/** Only in the angle an earlier, contaminated run saved to history. */
const EARLIER_ANGLE = "Position Harbor as a private AI cluster for the office";

const HARBOR_APP_URL = "https://harbor-app.example/";
const MARKET_URL = "https://news.example/show-hn-norms";

type Subject = "market" | "company" | "namesake";

/** The synthesizer's model: what it makes of the Harbor app page. */
function synthesizerCalls(harborApp: Subject): void {
    mockSynthesizer.mockResolvedValue({
        results: [
            {
                sourceUrl: MARKET_URL,
                summary: "Plain launch titles do best.",
                description: "Bears on how a launch post is worded.",
                subject: "market",
            },
            {
                sourceUrl: HARBOR_APP_URL,
                summary: `Harbor turns Macs into ${NAMESAKE_TREND}.`,
                description: "Essential product context for Harbor.",
                subject: harborApp,
            },
        ],
    });
}

/** The messages of the one call made under this name: [rules, input]. */
function shown(name: string): readonly BaseMessageLike[] {
    const call = mockModel.mock.calls.find(([, , callName]) => callName === name);
    if (!call) throw new Error(`no ${name} call`);
    return call[1];
}

function input(name: string): string {
    return (shown(name)[1] as HumanMessage).content as string;
}

function rules(name: string): string {
    return (shown(name)[0] as SystemMessage).content as string;
}

/** The strategist's input, cut into its three bands. */
function bands(): { aboutUs: string; outsideWorld: string; earlierPosts: string } {
    const text = input("multi_strategy");
    const outside = text.indexOf(OUTSIDE_WORLD_HEADING);
    const earlier = text.indexOf(EARLIER_POSTS_HEADING);
    const request = text.indexOf("# USER REQUEST");
    expect(text.indexOf(ABOUT_US_HEADING)).toBe(0);
    expect(outside).toBeGreaterThan(0);
    expect(earlier).toBeGreaterThan(outside);
    expect(request).toBeGreaterThan(earlier);
    return {
        aboutUs: text.slice(0, outside),
        outsideWorld: text.slice(outside, earlier),
        earlierPosts: text.slice(earlier, request),
    };
}

const run = () =>
    runMarketingPipeline({
        companyId: 1,
        input: { platform: "linkedin", prompt: "Launch post for Harbor" },
    });

beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.mocked(getCachedTrendSearch).mockReset().mockReturnValue(null);
    vi.mocked(getCompanyIdentity).mockResolvedValue({ data: IDENTITY } as never);
    vi.mocked(buildCompanyKnowledgeContext).mockResolvedValue(KNOWLEDGE);
    vi.mocked(extractCompanyDNA).mockResolvedValue({
        dna: DNA,
        debug: { source: "metadata", contextUsed: "", dna: DNA },
    });
    vi.mocked(getPerformanceHistory).mockResolvedValue([
        {
            platform: "linkedin",
            message: "An earlier post.",
            angle: EARLIER_ANGLE,
            impressions: null,
            engagements: null,
            clicks: null,
        },
    ]);

    // Trend search: a real market article, and the unrelated app called Harbor.
    vi.mocked(executeSearch).mockResolvedValue({
        providerUsed: "exa",
        results: [
            {
                url: MARKET_URL,
                title: "What gets a launch post read",
                content: "Plain titles and a working demo beat marketing copy.",
                score: 0.9,
            },
            {
                url: HARBOR_APP_URL,
                title: `Harbor: turn Macs into ${NAMESAKE_TREND}`,
                content: "Harbor pools the Macs in your office into one cluster.",
                score: 0.8,
            },
        ],
    } as never);
    // Competitor search: a rival, and the unrelated boilerplate called LaunchStack.
    vi.mocked(searchWeb).mockResolvedValue({
        results: [
            {
                title: "Rivalsoft: answers from your wiki",
                url: "https://rivalsoft.example/",
                snippet: "Rivalsoft answers questions from a company wiki.",
            },
            {
                title: "LaunchStack: the SaaS boilerplate",
                url: "https://launchstack-boilerplate.example/",
                snippet: `Integrated backend scaffolding covering ${NAMESAKE_STACK}.`,
            },
        ],
    } as never);

    mockSynthesizer.mockReset();
    mockModel.mockReset();
    mockModel.mockImplementation((async (_schema: unknown, _messages: unknown, name: string) => {
        switch (name) {
            case "competitor_analysis":
                // The analyst fell for the boilerplate: the worst it can do.
                return {
                    competitors: [
                        {
                            name: "Rivalsoft",
                            positioning: "Answers from a company wiki",
                            weaknesses: ["no citations"],
                        },
                    ],
                    ourAdvantages: [`Integrated backend scaffolding covering ${NAMESAKE_STACK}`],
                    marketGaps: ["answers nobody can check"],
                    messagingAntiPatterns: ["AI-powered"],
                };
            case "multi_strategy":
                return {
                    variants: [
                        {
                            variantId: "proof-driven",
                            angleRationale: "It is what the documents show.",
                            angle: "Answers you can check",
                            keyProof: ["every answer cites the page it came from"],
                            humanHook: "We stopped answering the same question twice.",
                            avoidList: ["AI-powered"],
                        },
                    ],
                };
            default:
                return { platform: "linkedin", message: "A post.", "image/video": "image" };
        }
    }) as never);
});

describe("a search result about something that only shares our name", () => {
    it.each<Subject>(["namesake", "company"])(
        "reaches neither the strategist nor the generator when the synthesizer calls it %s",
        async subject => {
            synthesizerCalls(subject);

            const result = await run();

            // The market article is still there to frame the post…
            expect(result.research.map(r => r.url)).toEqual([MARKET_URL]);
            expect(input("multi_strategy")).toContain("Plain launch titles do best.");
            // …and the Harbor app is nowhere either model can read it.
            expect(input("multi_strategy")).not.toContain(NAMESAKE_TREND);
            expect(input("multi_strategy")).not.toContain("Essential product context");
            expect(input("marketing_pipeline_output")).not.toContain(NAMESAKE_TREND);
            expect(input("marketing_pipeline_output")).not.toContain("Essential product context");
        }
    );

    it("is labelled as the outside world wherever it lands, if it slips through as market", async () => {
        synthesizerCalls("market");

        await run();

        const { aboutUs, outsideWorld } = bands();
        expect(outsideWorld).toContain(NAMESAKE_TREND);
        expect(aboutUs).not.toContain(NAMESAKE_TREND);

        const post = input("marketing_pipeline_output");
        const trends = post.indexOf(
            "Trend references (the outside world, from web search: narrative hooks or framing only, never quote or attribute, never facts about us):"
        );
        const strategy = post.indexOf("Messaging strategy (use this angle and proof");
        expect(trends).toBeGreaterThan(post.indexOf("Company context (source of truth"));
        expect(post.indexOf(NAMESAKE_TREND)).toBeGreaterThan(trends);
        expect(post.lastIndexOf(NAMESAKE_TREND)).toBeLessThan(strategy);
    });
});

describe("what the strategist may draw keyProof from", () => {
    it("is the ABOUT US band, which holds our documents and nothing from the web", async () => {
        synthesizerCalls("market");

        await run();

        const { aboutUs } = bands();
        expect(aboutUs).toContain("## Company DNA");
        expect(aboutUs).toContain("Differentiators: every answer cites the page it came from");
        expect(aboutUs).toContain("Proven results: halved onboarding questions on our own team");
        // Not the trend, not the analyst's list, not a competitor, not an old angle.
        expect(aboutUs).not.toContain(NAMESAKE_TREND);
        expect(aboutUs).not.toContain(NAMESAKE_STACK);
        expect(aboutUs).not.toContain("Rivalsoft");
        expect(aboutUs).not.toContain(EARLIER_ANGLE);
    });

    it("keeps the analyst's contaminated advantages out of it, marked as a judgement", async () => {
        synthesizerCalls("namesake");

        await run();

        const { outsideWorld } = bands();
        expect(outsideWorld).toContain(
            `Where the analyst thinks we win (a judgement, not proof; use only what Company DNA also says): Integrated backend scaffolding covering ${NAMESAKE_STACK}`
        );
        // The old label presented it as ours.
        expect(input("multi_strategy")).not.toContain("Our advantages:");
    });

    it("keeps an earlier run's angle out of it, so one bad run does not teach the next", async () => {
        synthesizerCalls("namesake");

        await run();

        const { earlierPosts } = bands();
        expect(earlierPosts).toContain(`Previously used angles: ${EARLIER_ANGLE}`);
        expect(input("multi_strategy").indexOf(EARLIER_ANGLE)).toBeGreaterThan(
            input("multi_strategy").indexOf(EARLIER_POSTS_HEADING)
        );
    });

    it("is spelled out in the strategist's rules", async () => {
        synthesizerCalls("namesake");

        await run();

        const strategist = rules("multi_strategy");
        expect(strategist).toContain(
            "keyProof: 2–4 proof points, each taken from the Company DNA section. Nothing under THE OUTSIDE WORLD or OUR EARLIER POSTS is proof."
        );
        expect(strategist).toContain(
            "web search finds other companies and products that happen to share our company's name or a product name of ours. They are not us."
        );
        // The old wording let proof come from anywhere in the context.
        expect(strategist).not.toContain("proof points from the company DNA or context");
    });
});

describe("the generator", () => {
    it("is told the company context outranks the strategy and a trend's product is never ours", async () => {
        synthesizerCalls("namesake");

        await run();

        const generator = rules("marketing_pipeline_output");
        expect(generator).toContain(
            "A product in a trend reference is never ours, whatever it is called"
        );
        expect(generator).toContain(
            "The company context outranks the strategy. If the angle, a key proof point or the hook says something about our product that the company context does not say, leave that part out; never repeat it as fact."
        );
    });
});

describe("campaign trend research", () => {
    it("keeps a result from a search cached before results said who they were about", async () => {
        vi.mocked(getCachedTrendSearch).mockReturnValue({
            results: [
                { sourceUrl: MARKET_URL, summary: "An older trend", description: "About it" },
            ],
            metadata: { query: "q", companyContext: "c", categories: [], createdAt: "" },
        });

        const results = await researchPlatformTrends({
            platform: "linkedin",
            prompt: "Launch post for Harbor",
            companyName: "LaunchStack Dev",
            companyContext: "Company: LaunchStack Dev.",
            maxResults: 3,
        });

        expect(results).toEqual([
            { title: "An older trend", url: MARKET_URL, snippet: "About it", source: "linkedin" },
        ]);
        expect(mockSynthesizer).not.toHaveBeenCalled();
    });

    it("fills its quota from market results, not from one about our own company", async () => {
        mockSynthesizer.mockResolvedValue({
            results: [
                {
                    sourceUrl: HARBOR_APP_URL,
                    summary: "LaunchStack Dev's Harbor does inference.",
                    description: "About the company.",
                    subject: "company",
                },
                {
                    sourceUrl: MARKET_URL,
                    summary: "Plain launch titles do best.",
                    description: "Bears on wording.",
                    subject: "market",
                },
            ],
        });

        const results = await researchPlatformTrends({
            platform: "linkedin",
            prompt: "Launch post for Harbor",
            companyName: "LaunchStack Dev",
            companyContext: "Company: LaunchStack Dev.",
            maxResults: 1,
        });

        expect(results.map(r => r.url)).toEqual([MARKET_URL]);
    });
});
