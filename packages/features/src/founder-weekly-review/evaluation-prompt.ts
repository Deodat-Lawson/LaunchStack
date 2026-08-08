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
export const founderWeeklyReviewGraderRubric = `
Evaluate the Founder Weekly Review based on:

1. Groundedness
- Are every factual claims directly supported by cited evidence?
- Are cited sourceIds semantically appropriate for the claim?
- Does the report avoid inventing customer feedback, shipped work, blockers, or outcomes?
- Does the report avoid turning plans or documents into facts?

2. Materiality
- Did the report identify the most important changes during the reporting period?
- Did it avoid spending attention on minor or irrelevant updates?
- Did it include meaningful evidence themes instead of ignoring important changes?

3. Temporal Accuracy
- Does the report correctly distinguish between:
  - changed this week
  - shipped this week
  - planned work
  - recommendations
  - historical context

- Planned work must not be represented as shipped.
- Document changes should only appear as "what changed" unless there is separate shipping evidence.
- Multiple document versions should preserve the sequence of changes instead of collapsing unrelated updates incorrectly.

- workspace_document evidence represents current workspace context.
- It must not be represented as an in-period change unless there is explicit change evidence.
- workspace_document evidence may support blockers, context, or recommendations.

A technically valid citation may still be semantically unsupported if the cited evidence does not actually justify the claim being made.

4. Synthesis Quality
- Does the report connect multiple evidence sources when appropriate?
- Does it summarize patterns across evidence rather than simply repeating individual events?
- Does it provide founder-level interpretation while remaining grounded in evidence?

5. Actionability
- Are recommendations specific and useful?
- Do recommendations clearly separate evidence-backed observations from suggested actions?
- Would a founder know what decision, follow-up, or next step to take?
- Does the report help a founder make decisions?
- Does it highlight what deserves attention instead of merely summarizing activity?

When evaluating failures:
- Mark unsupported claims as groundedness failures.
- Mark planned work presented as shipped as temporal accuracy failures.
- Mark missing important evidence as materiality failures.
- Mark weak summaries that only restate evidence as synthesis quality failures.
`;