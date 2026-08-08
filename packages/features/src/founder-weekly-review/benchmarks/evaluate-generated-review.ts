import { 
  evaluateFounderWeeklyReview,
  type EvaluationFailure,
} from "../evaluation";
import { 
  FounderWeeklyReviewV2PayloadSchema,
  type FounderWeeklyReviewV2Payload,
} from "../contracts";
import { 
  type FounderWeeklyReviewGenerateFn,
  gradeFounderWeeklyReview,
} from "@launchstack/features/founder-weekly-review";
import { LLMGraderResult } from "../llm-grader";

export type GeneratedReviewEvaluation = {
  deterministic: ReturnType<typeof evaluateFounderWeeklyReview> | null;
  llmGrader?: LLMGraderResult;
  failures: EvaluationFailure[];
};

export async function evaluateGeneratedFounderWeeklyReview(
  evidenceSnapshot: Parameters<typeof evaluateFounderWeeklyReview>[0],
  generatedReport: FounderWeeklyReviewV2Payload,
  generate: FounderWeeklyReviewGenerateFn
): Promise<GeneratedReviewEvaluation> {
  const schemaResult = FounderWeeklyReviewV2PayloadSchema.safeParse(
    generatedReport
  );

  if (!schemaResult.success) {
    return {
      deterministic: null,
      failures: [
        {
          category: "malformed_payload",
          explanation: "Report failed schema validation.",
        } satisfies EvaluationFailure
      ],
    };
  }

  const result = evaluateFounderWeeklyReview(
    evidenceSnapshot,
    generatedReport
  );

  const llmGrader = await gradeFounderWeeklyReview({
    evidenceSnapshot,
    report: generatedReport,
    generate,
  });

  return {
    deterministic: result,
    llmGrader,
    failures: result.failures,
  };
}