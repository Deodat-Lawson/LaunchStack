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
export declare const JUDGE_RUBRIC_VERSION = "2026-08-01.1";
/** Criteria the judge scores for one post (0–100 each). Ids match CriterionIdEnum. */
export declare const JUDGE_CRITERIA: readonly [
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
];
export type JudgeCriterion = (typeof JUDGE_CRITERIA)[number];
/** One-line definition per criterion, injected into the judge prompt. */
export declare const CRITERION_GUIDE: Record<JudgeCriterion, string>;
/** Structured-output shape the judge must return (no rewrite field). */
export declare const JudgeCriterionScoreSchema: z.ZodObject<
    {
        criterion: z.ZodEnum<
            [
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
            ]
        >;
        score: z.ZodNumber;
        rationale: z.ZodString;
    },
    "strip",
    z.ZodTypeAny,
    {
        rationale: string;
        criterion:
            | "brand_voice"
            | "groundedness"
            | "specificity"
            | "audience_relevance"
            | "goal_alignment"
            | "platform_structure"
            | "hook_strength"
            | "cta_quality"
            | "cliche_generic"
            | "citation_coverage";
        score: number;
    },
    {
        rationale: string;
        criterion:
            | "brand_voice"
            | "groundedness"
            | "specificity"
            | "audience_relevance"
            | "goal_alignment"
            | "platform_structure"
            | "hook_strength"
            | "cta_quality"
            | "cliche_generic"
            | "citation_coverage";
        score: number;
    }
>;
export declare const JudgeResultSchema: z.ZodObject<
    {
        scores: z.ZodEffects<
            z.ZodArray<
                z.ZodObject<
                    {
                        criterion: z.ZodEnum<
                            [
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
                            ]
                        >;
                        score: z.ZodNumber;
                        rationale: z.ZodString;
                    },
                    "strip",
                    z.ZodTypeAny,
                    {
                        rationale: string;
                        criterion:
                            | "brand_voice"
                            | "groundedness"
                            | "specificity"
                            | "audience_relevance"
                            | "goal_alignment"
                            | "platform_structure"
                            | "hook_strength"
                            | "cta_quality"
                            | "cliche_generic"
                            | "citation_coverage";
                        score: number;
                    },
                    {
                        rationale: string;
                        criterion:
                            | "brand_voice"
                            | "groundedness"
                            | "specificity"
                            | "audience_relevance"
                            | "goal_alignment"
                            | "platform_structure"
                            | "hook_strength"
                            | "cta_quality"
                            | "cliche_generic"
                            | "citation_coverage";
                        score: number;
                    }
                >,
                "many"
            >,
            {
                rationale: string;
                criterion:
                    | "brand_voice"
                    | "groundedness"
                    | "specificity"
                    | "audience_relevance"
                    | "goal_alignment"
                    | "platform_structure"
                    | "hook_strength"
                    | "cta_quality"
                    | "cliche_generic"
                    | "citation_coverage";
                score: number;
            }[],
            {
                rationale: string;
                criterion:
                    | "brand_voice"
                    | "groundedness"
                    | "specificity"
                    | "audience_relevance"
                    | "goal_alignment"
                    | "platform_structure"
                    | "hook_strength"
                    | "cta_quality"
                    | "cliche_generic"
                    | "citation_coverage";
                score: number;
            }[]
        >;
        overall: z.ZodNumber;
        summary: z.ZodString;
    },
    "strip",
    z.ZodTypeAny,
    {
        summary: string;
        scores: {
            rationale: string;
            criterion:
                | "brand_voice"
                | "groundedness"
                | "specificity"
                | "audience_relevance"
                | "goal_alignment"
                | "platform_structure"
                | "hook_strength"
                | "cta_quality"
                | "cliche_generic"
                | "citation_coverage";
            score: number;
        }[];
        overall: number;
    },
    {
        summary: string;
        scores: {
            rationale: string;
            criterion:
                | "brand_voice"
                | "groundedness"
                | "specificity"
                | "audience_relevance"
                | "goal_alignment"
                | "platform_structure"
                | "hook_strength"
                | "cta_quality"
                | "cliche_generic"
                | "citation_coverage";
            score: number;
        }[];
        overall: number;
    }
>;
export type JudgeResult = z.infer<typeof JudgeResultSchema>;
export declare const JUDGE_SYSTEM_PROMPT: string;
/** Build the human turn: platform reference standard + the candidate to score. */
export declare function buildJudgeHumanPrompt(args: {
    platform: string;
    referenceMarkdown: string;
    companyContext: string;
    post: string;
}): string;
//# sourceMappingURL=rubric.d.ts.map
