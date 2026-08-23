/**
 * content-scoring — one rubric, two consumers (unification PR-5).
 *
 * The offline benchmark judge (scorePost, versioned rubric) and the live
 * quality gate (validatePostQuality) previously lived in different modules
 * with no shared vocabulary; a third scoring surface — variant ranking —
 * didn't exist at all. This tool hosts the first two; ranking arrives with
 * the P2 stage-runner change, benchmark-gated.
 *
 * scorePost SCORES ONLY (never rewrites); validatePostQuality keeps its
 * pre-extraction rewrite-on-low-score behavior for the gate's callers.
 */

import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import type { ResolveChatModelOptions } from "@launchstack/core/llm";

import { invokeToolStructured } from "../llm";
import type { MarketingPlatform, ReferencePlatform } from "../platform-profiles";
import {
    buildJudgeHumanPrompt,
    JUDGE_RUBRIC_VERSION,
    JUDGE_SYSTEM_PROMPT,
    JudgeResultSchema,
    type JudgeResult,
} from "./rubric";

export * from "./rubric";
export type { ReferencePlatform } from "../platform-profiles";

export const CONTENT_SCORING_MODELS = {
    /** temperature 0 for repeatability; resolves the deployment's default route. */
    judge: { temperature: 0 },
    /** The live gate ran route "fast" before extraction. */
    qualityGate: { route: "fast" },
} as const satisfies Record<string, ResolveChatModelOptions>;

// ─── Offline judge (raw scores, never rewrites) ──────────────────────────────

export interface JudgePostInput {
    platform: ReferencePlatform;
    /** Company-context window the post was generated from (mirror of generation). */
    companyContext: string;
    /** The candidate post to score. */
    post: string;
    /** Calibration examples (see platform-profiles REFERENCE_POSTS). */
    referenceMarkdown: string;
}

export interface ScoredPost extends JudgeResult {
    platform: ReferencePlatform;
    judgeModel: string;
    rubricVersion: string;
}

export async function scorePost(input: JudgePostInput): Promise<ScoredPost> {
    // Single sample for now (N-sample median is a possible later stability
    // upgrade); the wire model id is recorded on every result.
    const { result, modelId } = await invokeToolStructured(
        CONTENT_SCORING_MODELS.judge,
        JudgeResultSchema,
        [
            new SystemMessage(JUDGE_SYSTEM_PROMPT),
            new HumanMessage(
                buildJudgeHumanPrompt({
                    platform: input.platform,
                    referenceMarkdown: input.referenceMarkdown,
                    companyContext: input.companyContext,
                    post: input.post,
                })
            ),
        ],
        "post_evaluation"
    );

    return {
        ...result,
        platform: input.platform,
        judgeModel: modelId,
        rubricVersion: JUDGE_RUBRIC_VERSION,
    };
}

// ─── Live quality gate (rewrites below the threshold) ────────────────────────

export const QualityScoreSchema = z.object({
    score: z.number().min(1).max(10),
    issues: z.array(z.string()),
    rewrite: z.string().nullable(),
});
export type QualityScore = z.infer<typeof QualityScoreSchema>;

export const QUALITY_THRESHOLD = 6;

// ─── Variant ranking (P2; replaces blind variants[0] when enabled) ──────────

export interface VariantScore {
    index: number;
    /** 1–10 quality score, or null when scoring this variant failed. */
    score: number | null;
    issues: string[];
}

export interface VariantRanking {
    scores: VariantScore[];
    bestIndex: number;
}

/** Pure selection over per-variant scores — exported for tests. */
export function buildVariantRanking(scores: Array<QualityScore | null>): VariantRanking {
    const variantScores: VariantScore[] = scores.map((s, index) => ({
        index,
        score: s?.score ?? null,
        issues: s?.issues ?? [],
    }));

    let bestIndex = 0;
    let best = -Infinity;
    for (const s of variantScores) {
        if (s.score != null && s.score > best) {
            best = s.score;
            bestIndex = s.index;
        }
    }
    return { scores: variantScores, bestIndex };
}

/**
 * Score each variant with the quality rubric and pick the best (ties and
 * all-scoring-failed fall back to index 0 — the pre-ranking behavior).
 * Costs one extra LLM call per variant; callers gate it accordingly.
 */
export async function rankVariants(args: {
    posts: string[];
    platform: MarketingPlatform;
}): Promise<VariantRanking> {
    const settled = await Promise.allSettled(
        args.posts.map(post => validatePostQuality(post, args.platform))
    );
    return buildVariantRanking(
        settled.map(result => (result.status === "fulfilled" ? result.value : null))
    );
}

export async function validatePostQuality(
    post: string,
    platform: MarketingPlatform
): Promise<QualityScore> {
    const { result } = await invokeToolStructured(
        CONTENT_SCORING_MODELS.qualityGate,
        QualityScoreSchema,
        [
            new SystemMessage(
                `You are a social media copy editor. Score this ${platform} post 1-10 on these criteria:
1. Hook strength (does the first line stop the scroll?)
2. Authenticity (does it sound like a person, not a brand?)
3. Platform fit (does it match ${platform} conventions?)
4. Specificity (are claims backed by concrete details, not vague hype?)
5. Structure (is it narrative-driven rather than a feature list?)

If score < ${QUALITY_THRESHOLD}, provide a "rewrite" field with an improved version that fixes the issues.
Flag specific issues in "issues" array.`
            ),
            new HumanMessage(post),
        ],
        "quality_check"
    );

    return result;
}
