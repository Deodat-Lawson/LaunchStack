import { z, type ZodType } from "zod";
import { founderWeeklyReviewGraderRubric } from "./evaluation-prompt";
import { LLMGraderResultSchema, type LLMGraderResult } from "./llm-grader";
import{
  type FounderWeeklyReviewEvidenceSnapshot,
  type FounderWeeklyReviewV2Payload,
} from "./contracts";

export type FounderWeeklyReviewGenerateFn = <TSchema extends ZodType>(
  input: {
    system?: string;
    prompt: string;
    schema: TSchema;
    schemaName?: string;
    temperature?: number;
  },
) => Promise<{
  object: z.infer<TSchema>;
  metadata: {
    provider: string;
    model: string;
    promptVersion?: string;
  };
}>;

export async function gradeFounderWeeklyReview(
  params: {
    evidenceSnapshot: FounderWeeklyReviewEvidenceSnapshot;
    report: FounderWeeklyReviewV2Payload;
    generate: FounderWeeklyReviewGenerateFn;
  },
): Promise<LLMGraderResult> {
  const result = await params.generate({
    schema: LLMGraderResultSchema,
    schemaName: "founder_weekly_review_grader",
    temperature: 0,
    system: founderWeeklyReviewGraderRubric,
    prompt: `
Evidence:
${JSON.stringify(params.evidenceSnapshot, null, 2)}

Report:
${JSON.stringify(params.report, null, 2)}
`,
  });

  return LLMGraderResultSchema.parse({
    ...result.object,
    metadata: {
      provider: result.metadata.provider,
      model: result.metadata.model,
      promptVersion: "founder_weekly_review_grader_v1",
    },
  });
}