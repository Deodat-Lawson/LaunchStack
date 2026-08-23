import { z } from "zod";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { getPlatformProfile, type PlatformMeta } from "@launchstack/tools/platform-profiles";
import { QUALITY_THRESHOLD, validatePostQuality } from "@launchstack/tools/content-scoring";
import { invokeMarketingStructured } from "./models";
import type {
    MarketingPlatform,
    MarketingResearchResult,
    MessagingStrategy,
    BrandVoice,
    TargetPersona,
    ContentType,
    StrategyVariant,
    ContentVariant,
    RefinementResult,
} from "./types";
import { MarketingPipelineOutputSchema } from "./types";

const SYSTEM_PROMPT_BASE = `You are a sharp B2B copywriter who writes like an operator sharing hard-won lessons—not a brand broadcasting announcements.

Voice & craft:
- Write as a knowledgeable peer, not a marketing department. First person ("we", "our team") is fine.
- Lead every post with tension, contrast, or a surprising insight. The first line must stop the scroll.
- Every sentence must earn its place. Cut filler, qualifiers, and throat-clearing ("Introducing…", "We're excited to…").
- Match format to content: use narrative paragraphs for stories and lessons learned; use structured bullets/lists for educational breakdowns, comparisons, or frameworks. Pick whichever serves the message best.
- End with a SINGLE question or soft CTA that invites genuine conversation, not a generic "Let's connect!" Only one question — never two in a row.
- Use trend references to frame the narrative or set up a tension, but never quote or attribute them directly.

Staying honest (CRITICAL — violations make the content unusable):
- Company context is your SINGLE SOURCE OF TRUTH for product claims, features, metrics, and results.
- NEVER invent capabilities, partnerships, customers, numbers, or people/names not in the company context.
- NEVER fabricate case studies, testimonials, or anecdotes with made-up names (e.g. "Sarah, a CTO..."). If a human hook is needed, use "we" or "our team" — NEVER a fictional character.
- NEVER reference or attribute specific facts to external companies (e.g. "Snowflake's feature", "Company X's approach") from trend references. Trends are for framing only.
- If a detail isn't in the context, reframe it as a general industry observation or an open question.
- If the company context is sparse, write about the INDUSTRY PROBLEM and the company's general approach — do NOT fill gaps with invented specifics.
- Skip hype words ("revolutionary", "game-changing", "best-in-class") unless the context explicitly supports them.

STRICT anti-patterns — NEVER do any of these:
- NEVER list product features as bullet points (e.g. "Here's how X empowers you: - Feature A… - Feature B…"). Weave capabilities into a narrative instead.
- NEVER acknowledge product shortcomings, roadmap gaps, or areas "we're still working on." Marketing copy should project confidence.
- NEVER open with generic statements like "Many teams find themselves…" or "In today's fast-paced world…". These are the same as "Excited to announce" — instant scroll-past.
- NEVER use more than 3 hashtags on LinkedIn, 2 on X, or 0 on Reddit. Fewer is always better.
- NEVER end with two questions. Pick one focused question.
- NEVER write in a way that reads like a product page, press release, or ad copy.

Media selection:
- Pick "image" for static visuals (diagrams, workflows, checklists, data snapshots).
- Pick "video" for demos, explainers, or anything that benefits from motion.

Output:
- Return JSON matching the schema exactly. No extra keys.`;

const STRATEGY_RULES = `
When a Messaging Strategy is provided:
- Lead with the recommended angle and human hook when it fits the platform; balance human story with technical depth.
- Back claims with the key proof points given; do not add proof not in company context.
- If the human hook mentions a named person, replace them with "we", "our team", "one of our engineers", etc. NEVER use fabricated character names.
- Do NOT use any phrase or theme in the strategy's avoid list.
- Do NOT reference external companies or products from trend references as if they are your own features or proof points.
- Keep the post aligned with the positioning angle while staying platform-native.`;

// helper to convert MarketingResearchResult[] into a compact text block
function formatTrendReferences(research: MarketingResearchResult[]): string {
    if (!research.length) return "None available.";

    return research
        .slice(0, 6)
        .map((r, i) => {
            const title = (r.title ?? "Untitled").trim().slice(0, 140);
            const snippet = (r.snippet ?? "").trim().replace(/\s+/g, " ").slice(0, 260);
            const url = (r.url ?? "").trim();
            return `${i + 1}) ${title}\n   ${snippet}${url ? `\n   ${url}` : ""}`;
        })
        .join("\n");
}

function formatStrategyBlock(strategy: MessagingStrategy): string {
    return [
        `Positioning angle: ${strategy.angle}`,
        `Key proof: ${strategy.keyProof.join("; ")}`,
        `Human hook: ${strategy.humanHook}`,
        `Avoid: ${strategy.avoidList.join("; ")}`,
    ].join("\n");
}

function buildPrompt(args: {
    platform: MarketingPlatform;
    prompt: string;
    companyContext: string;
    research: MarketingResearchResult[];
    strategy?: MessagingStrategy;
    platformMeta?: PlatformMeta;
}): string {
    const parts = [
        `Selected platform: ${args.platform}`,
        `User prompt: ${args.prompt}`,
        "",
        "Company context (source of truth — all product claims must come from here):",
        args.companyContext,
        "",
        "Trend references (use as narrative hooks or framing, never quote or attribute):",
        formatTrendReferences(args.research),
    ];
    if (args.strategy) {
        parts.push(
            "",
            "Messaging strategy (use this angle and proof; respect avoid list):",
            formatStrategyBlock(args.strategy)
        );
    }

    if (args.platformMeta?.subreddit) {
        parts.push(
            "",
            `Target subreddit: ${args.platformMeta.subreddit}`,
            "Tailor your tone and content to match this subreddit's norms and audience."
        );
    }
    if (args.platformMeta?.hashtags?.length) {
        parts.push(
            "",
            `Preferred hashtags (incorporate naturally if relevant): ${args.platformMeta.hashtags.join(", ")}`
        );
    }

    const profile = getPlatformProfile(args.platform);
    parts.push(
        "",
        profile.structureTemplate,
        "",
        profile.examples,
        "",
        "Task:",
        args.strategy
            ? "- Write ONE post using the messaging strategy angle and proof; respect the avoid list."
            : "- Pick ONE angle — a tension, trend, or insight — and commit to it.",
        "- Open with a hook that creates curiosity or contrast. Never open with an announcement or generic statement.",
        "- Build a short narrative arc: hook → insight/story → takeaway → CTA/question.",
        "- Write as a person sharing what they've learned, not a brand listing features.",
        "- NEVER list features as bullet points. Weave capabilities into the narrative naturally.",
        "- NEVER acknowledge product weaknesses or areas under development.",
        "- Ground all product claims in the company context. Reframe anything unsupported as an industry observation.",
        "- End with exactly ONE question or CTA, not two.",
        `- Use at most ${profile.maxHashtags} hashtags. Fewer is better.`,
        args.platformMeta?.hashtags?.length
            ? "- Prefer the user's preferred hashtags over generic ones."
            : "",
        "- Return JSON matching the schema exactly."
    );
    return parts.join("\n");
}

/* ──────────────────────────────────────────────────────────────
 * Voice & persona directives
 * ────────────────────────────────────────────────────────────── */

function buildVoiceDirective(voice: BrandVoice): string {
    return [
        "\n## Brand Voice Directive",
        `Tone: ${voice.toneDescriptor}`,
        `Formality: ${voice.formalityLevel}`,
        `Style: ${voice.sentenceStyle}`,
        `Use these characteristic phrases when natural: ${voice.vocabularyExamples.join(", ")}`,
        "Match this voice throughout the post.",
    ].join("\n");
}

function buildPersonaDirective(persona: TargetPersona): string {
    return [
        "\n## Audience Persona Directive",
        `Writing for: ${persona.role}`,
        `Their pain points: ${persona.painPoints.join("; ")}`,
        `They prioritize: ${persona.priorities.join("; ")}`,
        `Speak to them: ${persona.languageStyle}`,
        "Address their specific concerns. Make it feel written for them.",
    ].join("\n");
}

/* ──────────────────────────────────────────────────────────────
 * Content type templates
 * ────────────────────────────────────────────────────────────── */

function contentTypeTemplate(type: ContentType | undefined): string {
    switch (type) {
        case "thread":
            return "\nFORMAT: Write as a numbered thread (Tweet 1/N format). Each part should be self-contained but build a narrative. 3-6 parts max.";
        case "ad_copy":
            return "\nFORMAT: Write concise ad copy with a headline, sub-headline, body (2-3 lines), and CTA. Optimize for conversion.";
        case "email":
            return "\nFORMAT: Write as a marketing email with subject line, preview text, body, and CTA button text. Keep it scannable.";
        case "multi_platform":
            return "\nFORMAT: Provide versions for LinkedIn (long), X (short), and Reddit (community-style) in a single response. Separate with platform headers.";
        default:
            return "";
    }
}

/* ──────────────────────────────────────────────────────────────
 * Multi-variant generation (one per strategy)
 * ────────────────────────────────────────────────────────────── */

export async function generateVariants(args: {
    platform: MarketingPlatform;
    prompt: string;
    companyContext: string;
    research: MarketingResearchResult[];
    strategies: StrategyVariant[];
    enableQualityGate?: boolean;
    platformMeta?: PlatformMeta;
    brandVoice?: BrandVoice;
    targetPersona?: TargetPersona;
    contentType?: ContentType;
}): Promise<ContentVariant[]> {
    // allSettled (P2): one failed generation no longer discards its siblings —
    // survivors ship, in strategy order. Only a total failure aborts the stage.
    const settled = await Promise.allSettled(
        args.strategies.map(async strategy => {
            const strategyAsMessaging: MessagingStrategy = {
                angle: strategy.angle,
                keyProof: strategy.keyProof,
                humanHook: strategy.humanHook,
                avoidList: strategy.avoidList,
            };

            let systemPrompt = SYSTEM_PROMPT_BASE + STRATEGY_RULES;
            if (args.brandVoice) systemPrompt += buildVoiceDirective(args.brandVoice);
            if (args.targetPersona) systemPrompt += buildPersonaDirective(args.targetPersona);
            systemPrompt += contentTypeTemplate(args.contentType);

            const response = await invokeMarketingStructured(
                MarketingPipelineOutputSchema,
                [
                    new SystemMessage(systemPrompt),
                    new HumanMessage(
                        buildPrompt({
                            platform: args.platform,
                            prompt: args.prompt,
                            companyContext: args.companyContext,
                            research: args.research,
                            strategy: strategyAsMessaging,
                            platformMeta: args.platformMeta,
                        })
                    ),
                ],
                "marketing_pipeline_output"
            );

            let parsed = response;

            if (args.enableQualityGate) {
                try {
                    const quality = await validatePostQuality(parsed.message, args.platform);
                    if (quality.score < QUALITY_THRESHOLD && quality.rewrite) {
                        parsed = { ...parsed, message: quality.rewrite };
                    }
                } catch {
                    // keep original
                }
            }

            return {
                variantId: strategy.variantId,
                angleRationale: strategy.angleRationale,
                message: parsed.message,
                mediaType: parsed["image/video"],
            } satisfies ContentVariant;
        })
    );

    const variants: ContentVariant[] = [];
    const failures: Array<{ variantId: string; reason: unknown }> = [];
    settled.forEach((result, i) => {
        if (result.status === "fulfilled") {
            variants.push(result.value);
        } else {
            failures.push({ variantId: args.strategies[i]!.variantId, reason: result.reason });
        }
    });

    for (const failure of failures) {
        console.warn(
            `[marketing-pipeline] variant generation failed for ${failure.variantId}:`,
            failure.reason
        );
    }

    if (variants.length === 0) {
        throw new Error("All variant generations failed", { cause: failures[0]?.reason });
    }

    return variants;
}

/* ──────────────────────────────────────────────────────────────
 * Iterative refinement
 * ────────────────────────────────────────────────────────────── */

const RefinementSchema = z.object({
    message: z.string(),
    "image/video": z.enum(["image", "video"]),
    feedbackApplied: z.string(),
});

export async function refineContent(args: {
    platform: MarketingPlatform;
    originalMessage: string;
    feedback: string;
    companyContext: string;
    brandVoice?: BrandVoice;
}): Promise<RefinementResult> {
    let systemPrompt = `You are a marketing copywriter refining an existing post. Apply the user's feedback while maintaining the platform style and all original brand voice guidelines.

Rules:
- Apply the specific feedback the user gave.
- Keep the same general structure and angle unless the feedback asks to change it.
- Never invent product capabilities not in the company context.
- feedbackApplied: one sentence summarizing what you changed.
- Return JSON matching the schema.`;

    if (args.brandVoice) systemPrompt += buildVoiceDirective(args.brandVoice);

    const response = await invokeMarketingStructured(
        RefinementSchema,
        [
            new SystemMessage(systemPrompt),
            new HumanMessage(
                [
                    `Platform: ${args.platform}`,
                    `Original post:\n${args.originalMessage}`,
                    `\nUser feedback: ${args.feedback}`,
                    `\nCompany context:\n${args.companyContext}`,
                ].join("\n")
            ),
        ],
        "refined_content"
    );

    const parsed = response;
    return {
        variantId: "refined",
        message: parsed.message,
        mediaType: parsed["image/video"],
        feedbackApplied: parsed.feedbackApplied,
    };
}
