import { createHash } from "node:crypto";
import type { ZodType } from "zod";

import {
    FOUNDER_WEEKLY_REVIEW_V2_SCHEMA_VERSION,
    FounderWeeklyReviewV2PayloadSchema,
    type FounderWeeklyReviewEvidenceSnapshot,
    type FounderWeeklyReviewModelMetadata,
    type FounderWeeklyReviewV2Payload,
} from "./contracts";
import {
    assertUniqueSnapshotSourceIds,
    validateFounderWeeklyReviewV2Citations,
} from "./generation-validation";
import {
    buildFounderWeeklyReviewPrompt,
    FOUNDER_WEEKLY_REVIEW_PROMPT_VERSION,
    FOUNDER_WEEKLY_REVIEW_SYSTEM_PROMPT,
} from "./prompts";

export interface FounderWeeklyReviewResolvedGenerationMetadata {
    provider: string;
    model: string;
    capability: string;
    temperature: number;
    finishReason?: string;
    usage?: Record<string, string | number | boolean | null>;
    providerRequestId?: string;
}

export type FounderWeeklyReviewStructuredGenerator = <TSchema extends ZodType>(input: {
    system?: string;
    prompt: string;
    schema: TSchema;
    schemaName?: string;
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

export async function generateFounderWeeklyReview(
    input: GenerateFounderWeeklyReviewInput
): Promise<GenerateFounderWeeklyReviewResult> {
    const { evidenceSnapshot, generate } = input;
    assertUniqueSnapshotSourceIds(evidenceSnapshot);

    const prompt = buildFounderWeeklyReviewPrompt(evidenceSnapshot);
    const promptHash = createHash("sha256")
        .update(FOUNDER_WEEKLY_REVIEW_SYSTEM_PROMPT)
        .update(prompt)
        .digest("hex");

    if (evidenceSnapshot.items.length === 0) {
        return {
            reviewPayload: buildEmptyReview(),
            modelMetadata: buildMetadata(
                { provider: "skipped", model: "none", capability: "founderWeeklyReview", temperature: 0 },
                promptHash,
                true
            ),
        };
    }

    const result = await generate({
        system: FOUNDER_WEEKLY_REVIEW_SYSTEM_PROMPT,
        prompt,
        schema: FounderWeeklyReviewV2PayloadSchema,
        schemaName: "founder_weekly_review_v2",
    });
    const reviewPayload = validateFounderWeeklyReviewV2Citations(
        FounderWeeklyReviewV2PayloadSchema.parse(result.object),
        evidenceSnapshot
    );

    return { reviewPayload, modelMetadata: buildMetadata(result.metadata, promptHash, false) };
}

function buildMetadata(
    metadata: FounderWeeklyReviewResolvedGenerationMetadata,
    promptHash: string,
    skipped: boolean
): FounderWeeklyReviewModelMetadata {
    return {
        provider: metadata.provider,
        model: metadata.model,
        capability: metadata.capability,
        temperature: metadata.temperature,
        promptVersion: FOUNDER_WEEKLY_REVIEW_PROMPT_VERSION,
        promptHash,
        evidenceSchemaVersion: "founder-weekly-review-evidence/v1",
        reviewPayloadSchemaVersion: FOUNDER_WEEKLY_REVIEW_V2_SCHEMA_VERSION,
        ...(metadata.providerRequestId ? { completionId: metadata.providerRequestId } : {}),
        attributes: {
            ...(skipped ? { generationSkipped: true } : {}),
            ...(metadata.finishReason ? { finishReason: metadata.finishReason } : {}),
            ...(metadata.usage ? { usage: JSON.stringify(metadata.usage) } : {}),
        },
    };
}

function buildEmptyReview(): FounderWeeklyReviewV2Payload {
    const noEvidence = (message: string, cta: string) => ({
        state: "no_evidence" as const,
        noEvidence: { code: "no_relevant_evidence", message, cta },
    });
    return {
        schemaVersion: FOUNDER_WEEKLY_REVIEW_V2_SCHEMA_VERSION,
        sections: {
            whatChanged: noEvidence("No change evidence was supplied for this period.", "Add document changes or founder notes for this reporting period."),
            whatShipped: noEvidence("No shipment evidence was supplied for this period.", "Add release notes, deployment records, or GitHub activity."),
            whatCustomersSaid: noEvidence("No customer feedback was supplied for this period.", "Add customer calls, support feedback, or survey evidence."),
            currentBlockers: noEvidence("No blocker evidence was supplied for this period.", "Add founder context, project notes, or issue evidence describing blockers."),
            nextPriorities: noEvidence("No evidence is available to ground priorities.", "Add evidence for this period before requesting recommended priorities."),
        },
    };
}
