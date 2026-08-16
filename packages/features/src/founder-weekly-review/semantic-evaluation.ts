import { z } from "zod";

export const FOUNDER_WEEKLY_REVIEW_SEMANTIC_EVALUATION_SCHEMA_VERSION =
    "founder-weekly-review-semantic-evaluation/v1" as const;

export const FounderWeeklyReviewSemanticEvaluationSchema = z
    .object({
        schemaVersion: z
            .literal(FOUNDER_WEEKLY_REVIEW_SEMANTIC_EVALUATION_SCHEMA_VERSION)
            .default(FOUNDER_WEEKLY_REVIEW_SEMANTIC_EVALUATION_SCHEMA_VERSION),
        overallScore: z.number().min(0).max(1),
        dimensions: z
            .object({
                groundedness: z.number().min(0).max(1),
                materiality: z.number().min(0).max(1),
                temporalAccuracy: z.number().min(0).max(1),
                synthesisQuality: z.number().min(0).max(1),
                actionability: z.number().min(0).max(1),
            })
            .strict(),
        findings: z
            .array(
                z
                    .object({
                        category: z.enum([
                            "groundedness",
                            "materiality",
                            "temporalAccuracy",
                            "synthesisQuality",
                            "actionability",
                        ]),
                        severity: z.enum(["info", "minor", "major"]),
                        explanation: z.string().min(1).max(600),
                    })
                    .strict()
            )
            .max(6),
        summary: z.string().min(1).max(900),
    })
    .strict();

export type FounderWeeklyReviewSemanticEvaluation = z.infer<
    typeof FounderWeeklyReviewSemanticEvaluationSchema
>;

export interface FounderWeeklyReviewSemanticEvaluationResult {
    result: FounderWeeklyReviewSemanticEvaluation;
    metadata: {
        provider?: string;
        model?: string;
        promptVersion: string;
    };
}
