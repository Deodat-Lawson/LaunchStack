import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { invokeMarketingStructured } from "./models";
import type {
    CompanyDNA,
    CompetitorAnalysis,
    StrategyVariant,
    BrandVoice,
    TargetPersona,
} from "./types";
import { MultiStrategySchema } from "./types";

/**
 * The strategist's input is three bands, because what is in them is not
 * equally true of us:
 *
 * - ABOUT US: distilled from the workspace's own documents. The only place a
 *   proof point, or any statement about our product, may come from.
 * - THE OUTSIDE WORLD: competitors and trends found by web search. Good for
 *   choosing and framing an angle; never proof. Search runs on our name, so
 *   this band can hold a company or product that is merely called the same
 *   thing. The analyst's "where we win" list sits here too: it was written
 *   by a model that had just read those pages.
 * - OUR EARLIER POSTS: the angles of previous runs. A past angle that was
 *   wrong would otherwise be read back as a fact and repeated.
 *
 * The headings are exported so tests can check what sits under which.
 */
export const ABOUT_US_HEADING =
    "# ABOUT US: from our own documents. The only source for keyProof and for any fact about our company or product.";
export const OUTSIDE_WORLD_HEADING =
    "# THE OUTSIDE WORLD: found by web search. Use it to choose and frame an angle. Never proof, never a fact about us. A company or product below that shares our name is a different one: ignore it.";
export const EARLIER_POSTS_HEADING =
    "# OUR EARLIER POSTS: for variety and for what worked. An earlier angle is not a fact about us.";

function buildContextBlock(args: {
    dna: CompanyDNA;
    competitors: CompetitorAnalysis;
    trendsSummary?: string;
    userPrompt?: string;
    brandVoice?: BrandVoice;
    targetPersona?: TargetPersona;
    performanceInsights?: string[];
}): string {
    const MAX_COMPETITORS = 3;
    const MAX_WEAKNESSES = 2;
    const MAX_TRENDS_CHARS = 800;
    const {
        dna,
        competitors,
        trendsSummary = "",
        userPrompt = "",
        brandVoice,
        targetPersona,
        performanceInsights,
    } = args;

    const contextParts: string[] = [
        ABOUT_US_HEADING,
        "",
        "## Company DNA",
        `Mission: ${dna.coreMission}`,
        `Differentiators: ${dna.keyDifferentiators.join("; ")}`,
        `Proven results: ${dna.provenResults.join("; ")}`,
        `Human story: ${dna.humanStory}`,
        `Technical edge: ${dna.technicalEdge}`,
    ];

    if (brandVoice) {
        contextParts.push(
            "",
            "## Brand voice",
            `Tone: ${brandVoice.toneDescriptor}`,
            `Style: ${brandVoice.sentenceStyle}`,
            `Formality: ${brandVoice.formalityLevel}`,
            brandVoice.vocabularyExamples.length > 0
                ? `Characteristic phrases: ${brandVoice.vocabularyExamples.join(", ")}`
                : ""
        );
    }
    if (targetPersona) {
        contextParts.push(
            "",
            "## Target audience",
            `Role: ${targetPersona.role}`,
            `Pain points: ${targetPersona.painPoints.join("; ")}`,
            `Priorities: ${targetPersona.priorities.join("; ")}`,
            `Language style: ${targetPersona.languageStyle}`
        );
    }

    const topCompetitors = competitors.competitors.slice(0, MAX_COMPETITORS);
    contextParts.push(
        "",
        OUTSIDE_WORLD_HEADING,
        "",
        "## Competitor landscape",
        ...topCompetitors.map(
            c =>
                `- ${c.name}: ${c.positioning}. Weaknesses: ${c.weaknesses.slice(0, MAX_WEAKNESSES).join(", ")}`
        ),
        `Market gaps: ${competitors.marketGaps.join("; ")}`,
        `Messaging to avoid: ${competitors.messagingAntiPatterns.join("; ")}`
    );
    if (competitors.ourAdvantages.length > 0) {
        contextParts.push(
            `Where the analyst thinks we win (a judgement, not proof; use only what Company DNA also says): ${competitors.ourAdvantages.join("; ")}`
        );
    }
    if (trendsSummary.trim()) {
        contextParts.push(
            "",
            "## Platform / trend context",
            trendsSummary.trim().slice(0, MAX_TRENDS_CHARS)
        );
    }

    if (performanceInsights && performanceInsights.length > 0) {
        contextParts.push(
            "",
            EARLIER_POSTS_HEADING,
            "",
            "## Past performance insights",
            ...performanceInsights
        );
    }
    if (userPrompt.trim()) {
        contextParts.push("", "# USER REQUEST", userPrompt.trim());
    }
    return contextParts.join("\n");
}

/**
 * Build 3 strategy variants from different positioning angles.
 */
export async function buildMultiStrategy(args: {
    dna: CompanyDNA;
    competitors: CompetitorAnalysis;
    trendsSummary?: string;
    userPrompt?: string;
    brandVoice?: BrandVoice;
    targetPersona?: TargetPersona;
    performanceInsights?: string[];
}): Promise<StrategyVariant[]> {
    const systemPrompt = `You are a messaging strategist. Given company DNA, competitor analysis, and optional context, produce EXACTLY 3 distinct MessagingStrategy variants.

Each variant must take a DIFFERENT positioning angle:
- Variant 1 ("thought-leadership"): Lead with an industry insight or contrarian take that positions the company as a thought leader.
- Variant 2 ("pain-point"): Lead with a specific pain point the target audience faces, then show how the company solves it.
- Variant 3 ("proof-driven"): Lead with concrete metrics, outcomes, or case results that demonstrate value.

For EACH variant provide:
- variantId: one of "thought-leadership", "pain-point", "proof-driven"
- angleRationale: 1–2 sentences explaining WHY this angle was chosen.
- angle: the positioning angle (1–2 sentences).
- keyProof: 2–4 proof points, each taken from the Company DNA section. Nothing under THE OUTSIDE WORLD or OUR EARLIER POSTS is proof. NEVER cite external companies or products as proof. If Company DNA supports fewer than two, give fewer rather than fill the gap.
- humanHook: an emotional hook or relatable scenario using "we", "our team", or a generic role ("a CTO we spoke to"). NEVER invent named characters (no "Maya", "Jon", "Sarah"). NEVER fabricate testimonials.
- avoidList: 3–5 themes to avoid.

CRITICAL: Use ONLY information from the provided company DNA and context. Never cite external company products (like Snowflake, AWS, etc.) as your proof points — those are competitors, not evidence. If the company context is sparse, keep proof points general and honest.

CRITICAL: THE OUTSIDE WORLD comes from web search, and web search finds other companies and products that happen to share our company's name or a product name of ours. They are not us. Every statement about what our product is, does, is built with, or has achieved (in the angle, the proof and the hook) must come from ABOUT US. A trend or a competitor's gap may frame the angle; it may never describe us. If an earlier angle or the analyst's view says something about us that Company DNA does not, leave it out.

Return valid JSON with a "variants" array of exactly 3 objects.`;

    const response = await invokeMarketingStructured(
        MultiStrategySchema,
        [new SystemMessage(systemPrompt), new HumanMessage(buildContextBlock(args))],
        "multi_strategy"
    );

    return response.variants;
}
