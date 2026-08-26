import type { ZodType } from "zod";
import {
    type FounderWeeklyReviewEvidenceSnapshot,
    type FounderWeeklyReviewModelMetadata,
    type FounderWeeklyReviewV2Payload,
} from "./contracts.js";
export interface FounderWeeklyReviewResolvedGenerationMetadata {
    provider: string;
    model: string;
    capability: string;
    temperature?: number;
    finishReason?: string;
    usage?: Record<string, string | number | boolean | null>;
    providerRequestId?: string;
}
export type FounderWeeklyReviewStructuredGenerator = <TSchema extends ZodType>(input: {
    system?: string;
    prompt: string;
    schema: TSchema;
    schemaName?: string;
    generationPhase?: "initial" | "semantic-repair";
}) => Promise<{
    object: ReturnType<TSchema["parse"]>;
    metadata: FounderWeeklyReviewResolvedGenerationMetadata;
}>;
export interface GenerateFounderWeeklyReviewInput {
    evidenceSnapshot: FounderWeeklyReviewEvidenceSnapshot;
    generate: FounderWeeklyReviewStructuredGenerator;
}
export interface GenerateFounderWeeklyReviewResult {
    reviewPayload: FounderWeeklyReviewV2Payload;
    modelMetadata: FounderWeeklyReviewModelMetadata;
}
export declare function generateFounderWeeklyReview(
    input: GenerateFounderWeeklyReviewInput
): Promise<GenerateFounderWeeklyReviewResult>;
//# sourceMappingURL=generator.d.ts.map
