import type { FounderWeeklyReviewEvidenceSnapshot, FounderWeeklyReviewV2Payload } from "./contracts";

export const FOUNDER_WEEKLY_REVIEW_EVALUATION_PROMPT_VERSION = "founder-weekly-review-evaluation/v2" as const;
export function buildFounderWeeklyReviewEvaluationPrompt(snapshot: FounderWeeklyReviewEvidenceSnapshot, review: FounderWeeklyReviewV2Payload): string {
    return JSON.stringify({
        promptVersion: FOUNDER_WEEKLY_REVIEW_EVALUATION_PROMPT_VERSION,
        task: "Grade the persisted Founder Weekly Review against its immutable evidence snapshot. Return judgments, not a restatement of the review.",
        rubric: {
            groundedness: "Claims must be supported by cited snapshot evidence. Treat supports, indicates, and suggests as appropriately bounded language; penalize confirms/proves when the evidence is only a limited signal.",
            materiality: "Prioritize meaningful business-state changes over editorial rewrites. Do not reward one-bullet-per-source enumeration.",
            temporalAccuracy: "document_change is reporting-period temporal evidence. workspace_document is current context and cannot independently prove whatChanged or whatShipped. document_change plus workspace_document is valid when the document change establishes the temporal proposition and workspace only adds context. Explicitly distinguish planned, scheduled, or future releases from actually shipped during the reporting period; a future-dated release is not shipped in the current period.",
            synthesisQuality: "Judge coverage of major material business themes, not source-level citation coverage. Reward concise founder-level synthesis; several related sources may be synthesized into one founder-level claim. Reusing evidence across sections is acceptable when the section-specific meaning changes; penalize only repetition that adds no new meaning.",
            actionability: "Reward a clear action plus an evidence-grounded reason or dependency. Do not require or reward invented owners, dates, metrics, or sequencing that are absent from the evidence.",
        },
        snapshot,
        review,
    });
}
