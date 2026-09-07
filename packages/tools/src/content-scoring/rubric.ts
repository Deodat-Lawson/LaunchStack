import { z } from "zod";

/**
 * LLM-as-judge rubric for scoring a single marketing post.
 *
 * RAW SCORE ONLY. The judge scores each criterion 0–100 and gives a rationale.
 * It does NOT rewrite, suggest edits, or emit an improved version — that is a
 * hard rule of this benchmark (unlike the old inline `validatePostQuality`,
 * which rewrote below-threshold posts).
 *
 * Bump JUDGE_RUBRIC_VERSION on any wording change so runs stay comparable
 * (recorded alongside the judge model in every result).
 */

export const JUDGE_RUBRIC_VERSION = "2026-08-01.1";

/** Criteria the judge scores for one post (0–100 each). Ids match CriterionIdEnum. */
export const JUDGE_CRITERIA = [
    "groundedness",
    "specificity",
    "brand_voice",
    "audience_relevance",
    "goal_alignment",
    "platform_structure",
    "hook_strength",
    "cta_quality",
    "cliche_generic",
    "citation_coverage",
] as const;
export type JudgeCriterion = (typeof JUDGE_CRITERIA)[number];

/** One-line definition per criterion, injected into the judge prompt. */
export const CRITERION_GUIDE: Record<JudgeCriterion, string> = {
    groundedness:
        "Every factual claim is supported by the company context. Anything not in the context is ungrounded — score down hard for invented facts, metrics, or features.",
    specificity:
        "Concrete, company/product-specific details rather than generic filler that could apply to any company.",
    brand_voice: "Matches the company's tone and style implied by its context.",
    audience_relevance: "Speaks directly to the intended audience's priorities and pain points.",
    goal_alignment:
        "Serves the campaign goal (awareness / engagement / conversion / signups / community).",
    platform_structure: "Fits the platform's norms, length, and formatting conventions.",
    hook_strength: "The opening line earns attention and stops the scroll.",
    cta_quality:
        "Clear, appropriate call to action when one is warranted (do not penalize its absence when the goal doesn't need one).",
    cliche_generic:
        "Free of clichés, hype words, and generic AI phrasing. Higher score = cleaner, more human.",
    citation_coverage:
        "Claims that need evidence reference or point to it when the platform/goal expects proof.",
};

const CriterionEnum = z.enum(JUDGE_CRITERIA);

/** Structured-output shape the judge must return (no rewrite field). */
export const JudgeCriterionScoreSchema = z.object({
    criterion: CriterionEnum,
    score: z.number().min(0).max(100),
    rationale: z.string(),
});

export const JudgeResultSchema = z.object({
    // Exactly one entry per criterion in JUDGE_CRITERIA: no missing, no
    // duplicates. Unknown criterion ids are already rejected by CriterionEnum.
    scores: z.array(JudgeCriterionScoreSchema).superRefine((scores, ctx) => {
        const counts = new Map<string, number>();
        for (const s of scores) {
            counts.set(s.criterion, (counts.get(s.criterion) ?? 0) + 1);
        }
        for (const criterion of JUDGE_CRITERIA) {
            const n = counts.get(criterion) ?? 0;
            if (n === 0) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: `missing score for criterion "${criterion}"`,
                });
            } else if (n > 1) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: `duplicate scores (${n}) for criterion "${criterion}"`,
                });
            }
        }
    }),
    overall: z.number().min(0).max(100),
    summary: z.string(),
});
export type JudgeResult = z.infer<typeof JudgeResultSchema>;

export const JUDGE_SYSTEM_PROMPT = [
    "You are a strict, consistent evaluator of marketing social posts.",
    "You SCORE ONLY. You never rewrite the post, never suggest edits, and never output an improved version.",
    "Score each requested criterion from 0 to 100 (100 = as good as the best reference example, 0 = unusable).",
    "Use the platform reference below — labeled GOOD and BAD examples, each with the company context it was written from — as your calibration bar.",
    "Judge groundedness strictly against the candidate's OWN company context: any claim, metric, or feature not present there is ungrounded.",
    "Be consistent: the same post with the same context should always get the same scores.",
    "Return one entry per criterion using the exact criterion ids given, plus an overall score and a one-line summary.",
].join("\n");

/** Build the human turn: platform reference standard + the candidate to score. */
export function buildJudgeHumanPrompt(args: {
    platform: string;
    referenceMarkdown: string;
    companyContext: string;
    post: string;
}): string {
    const criteriaBlock = JUDGE_CRITERIA.map(c => `- ${c}: ${CRITERION_GUIDE[c]}`).join("\n");

    return [
        `PLATFORM: ${args.platform}`,
        "",
        "# Platform reference standard (calibration examples)",
        args.referenceMarkdown.trim(),
        "",
        "# Candidate to score",
        "## Company context (the knowledge this post was generated from)",
        args.companyContext.trim(),
        "",
        "## Post",
        args.post.trim(),
        "",
        "# Criteria to score (0–100 each)",
        criteriaBlock,
        "",
        "Score every criterion above for the candidate post. Provide a brief rationale",
        "per criterion, an overall 0–100, and a one-line summary. Score only — do NOT",
        "rewrite or suggest edits.",
    ].join("\n");
}
