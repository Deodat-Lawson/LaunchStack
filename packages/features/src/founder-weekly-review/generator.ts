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
    FounderWeeklyReviewGenerationValidationError,
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

    const initial = await generate({
        system: FOUNDER_WEEKLY_REVIEW_SYSTEM_PROMPT,
        prompt,
        schema: FounderWeeklyReviewV2PayloadSchema,
        schemaName: "founder_weekly_review_v2",
        generationPhase: "initial",
    });
    let result = initial;
    let reviewPayload: FounderWeeklyReviewV2Payload;
    try {
        reviewPayload = validateFounderWeeklyReviewV2Citations(
            FounderWeeklyReviewV2PayloadSchema.parse(initial.object),
            evidenceSnapshot
        );
        logGenerationValidation("initial", initial.metadata, "passed");
    } catch (error) {
        if (!(error instanceof FounderWeeklyReviewGenerationValidationError)) throw error;
        logGenerationValidation("initial", initial.metadata, "failed");
        const repaired = await generate({
            system: FOUNDER_WEEKLY_REVIEW_SYSTEM_PROMPT,
            prompt: buildSemanticRepairPrompt(initial.object, evidenceSnapshot, error),
            schema: FounderWeeklyReviewV2PayloadSchema,
            schemaName: "founder_weekly_review_v2",
            generationPhase: "semantic-repair",
        });
        result = repaired;
        try {
            reviewPayload = validateFounderWeeklyReviewV2Citations(
                FounderWeeklyReviewV2PayloadSchema.parse(repaired.object),
                evidenceSnapshot
            );
            logGenerationValidation("semantic-repair", repaired.metadata, "passed");
        } catch (repairError) {
            logGenerationValidation("semantic-repair", repaired.metadata, "failed");
            throw repairError;
        }
    }

    return { reviewPayload, modelMetadata: buildMetadata(result.metadata, promptHash, false) };
}

function buildSemanticRepairPrompt(
    candidate: FounderWeeklyReviewV2Payload,
    evidenceSnapshot: FounderWeeklyReviewEvidenceSnapshot,
    error: FounderWeeklyReviewGenerationValidationError
): string {
    const errors = error.details.length > 0
        ? error.details
        : [{ code: "report_validation_failed" }];
    const sources = evidenceSnapshot.items.map(({ sourceId, sourceType }) => ({ sourceId, sourceType }));
    return [
        "Correct the complete canonical Founder Weekly Review JSON candidate below.",
        "Customer Signals may cite only customer_feedback sources.",
        "founder_context is founder-provided direction, not customer testimony.",
        "Remove a customer claim if it lacks customer_feedback support.",
        "Do not invent or substitute a source ID.",
        "Return the complete corrected canonical JSON object only.",
        `Validation errors: ${JSON.stringify(errors)}`,
        `Source IDs and source types: ${JSON.stringify(sources)}`,
        `Previous canonical candidate: ${JSON.stringify(candidate)}`,
    ].join("\n");
}

function logGenerationValidation(
    phase: "initial" | "semantic-repair",
    metadata: FounderWeeklyReviewResolvedGenerationMetadata,
    result: "passed" | "failed"
): void {
    console.info(`[fwr] generation phase=${phase} provider=${metadata.provider} model=${metadata.model} validation=${result}`);
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
        ...(metadata.temperature === undefined ? {} : { temperature: metadata.temperature }),
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
