import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { invokeStructured } from "@launchstack/core/llm";

import {
    FOUNDER_WEEKLY_REVIEW_EVALUATION_PROMPT_VERSION,
    FounderWeeklyReviewSemanticEvaluationSchema,
    buildFounderWeeklyReviewEvaluationPrompt,
    type FounderWeeklyReviewEvidenceSnapshot,
    type FounderWeeklyReviewSemanticEvaluationResult,
    type FounderWeeklyReviewV2Payload,
} from "@launchstack/features/founder-weekly-review";
import { resolveConfiguredChatModel } from "~/lib/models";

export const FOUNDER_WEEKLY_REVIEW_EVALUATION_MAX_OUTPUT_TOKENS = 2_048;
export const FOUNDER_WEEKLY_REVIEW_EVALUATION_TIMEOUT_MS = 30_000;

const SYSTEM_PROMPT = `You are a strict Founder Weekly Review quality grader.

Return one structured result only. Do not repeat the review or evidence. Score each dimension from 0 to 1 and return at most six concise findings.

Ground claims only in the supplied immutable snapshot. Treat supports, indicates, and suggests as appropriately bounded language; penalize confirms or proves when evidence is limited. A workspace_document is current-state context and cannot independently prove a reporting-period change. A document_change may establish the temporal proposition while workspace context complements it. Planned, scheduled, or future-dated work is not shipped in an earlier reporting period.

Reward founder-relevant synthesis and concrete evidence-grounded actions. Do not reward source-by-source transcription. Do not require or reward invented owners, deadlines, metrics, or sequencing.`;

/** Diagnostic-only grading through the configured provider-neutral chat seam. */
export async function gradePersistedFounderWeeklyReview(
    snapshot: FounderWeeklyReviewEvidenceSnapshot,
    review: FounderWeeklyReviewV2Payload
): Promise<FounderWeeklyReviewSemanticEvaluationResult> {
    const resolved = resolveConfiguredChatModel({
        route: "default",
        timeoutMs: FOUNDER_WEEKLY_REVIEW_EVALUATION_TIMEOUT_MS,
        maxOutputTokens: FOUNDER_WEEKLY_REVIEW_EVALUATION_MAX_OUTPUT_TOKENS,
    });
    const result = FounderWeeklyReviewSemanticEvaluationSchema.parse(
        await invokeStructured(
            resolved,
            FounderWeeklyReviewSemanticEvaluationSchema,
            [
                new SystemMessage(SYSTEM_PROMPT),
                new HumanMessage(buildFounderWeeklyReviewEvaluationPrompt(snapshot, review)),
            ],
            { name: "founder_weekly_review_evaluation" }
        )
    );
    return {
        result,
        metadata: {
            provider: resolved.name,
            model: resolved.modelId,
            promptVersion: FOUNDER_WEEKLY_REVIEW_EVALUATION_PROMPT_VERSION,
        },
    };
}
