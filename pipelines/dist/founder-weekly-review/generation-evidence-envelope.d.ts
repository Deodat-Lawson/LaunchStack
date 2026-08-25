import type {
    FounderWeeklyReviewEvidenceItem,
    FounderWeeklyReviewEvidenceSnapshot,
} from "./contracts.js";
export declare const FOUNDER_WEEKLY_REVIEW_EVIDENCE_ENVELOPE_VERSION: "founder-weekly-review-evidence-envelope/v1";
export declare const FOUNDER_WEEKLY_REVIEW_GENERATION_EVIDENCE_BUDGET: Readonly<{
    totalSerializedCharacters: 72000;
    founderContextReservedCharacters: 4000;
    workspaceDocumentReservedCharacters: 24000;
    customerFeedbackReservedCharacters: 24000;
    documentChangeSerializedCharacters: 14000;
    documentChangeItems: 24;
    documentChangeItemsPerDocument: 8;
    estimatedCharactersPerToken: 4;
}>;
type SourceType = FounderWeeklyReviewEvidenceItem["sourceType"];
type MetadataValue = FounderWeeklyReviewEvidenceItem["metadata"][string];
export type FounderWeeklyReviewPromptEvidenceItem = Pick<
    FounderWeeklyReviewEvidenceItem,
    "sourceId" | "sourceType" | "title" | "excerpt"
> & {
    sourceTimestamp: string | null;
    metadata: Record<string, MetadataValue>;
};
export type GenerationEvidenceEnvelopeDiagnostics = {
    originalItemCount: number;
    selectedItemCount: number;
    excludedItemCount: number;
    selectedBySourceType: Record<SourceType, number>;
    excludedBySourceType: Record<SourceType, number>;
    serializedCharacterCount: number;
    estimatedTokenCount: number;
    truncated: boolean;
};
export type GenerationEvidenceEnvelope = {
    version: typeof FOUNDER_WEEKLY_REVIEW_EVIDENCE_ENVELOPE_VERSION;
    items: FounderWeeklyReviewPromptEvidenceItem[];
    diagnostics: GenerationEvidenceEnvelopeDiagnostics;
};
export declare class FounderWeeklyReviewGenerationEvidenceBudgetError extends Error {
    readonly code = "generation_evidence_budget_exceeded";
    constructor(message?: string);
}
export declare function buildFounderWeeklyReviewPromptEvidenceItem(
    item: FounderWeeklyReviewEvidenceItem
): FounderWeeklyReviewPromptEvidenceItem;
/** Builds a bounded prompt projection without mutating the immutable snapshot. */
export declare function buildGenerationEvidenceEnvelope(
    snapshot: FounderWeeklyReviewEvidenceSnapshot
): GenerationEvidenceEnvelope;
/** Local invariant check used immediately before prompt serialization/provider invocation. */
export declare function assertGenerationEvidenceEnvelopeWithinBudget(
    envelope: GenerationEvidenceEnvelope
): void;
export {};
//# sourceMappingURL=generation-evidence-envelope.d.ts.map
