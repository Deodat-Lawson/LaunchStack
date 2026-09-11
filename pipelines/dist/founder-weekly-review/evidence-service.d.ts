import { type FounderWeeklyReviewEvidenceItem, type FounderWeeklyReviewEvidenceSnapshot, type FounderWeeklyReviewEvidenceWarning, type ReportingPeriod } from "./contracts.js";
import { type DbClient } from "@launchstack/store/client";
import { type DocumentVersionForComparison, type VersionChunk } from "./document-change.js";
import { type WorkspaceDocumentRetrievalInput, type WorkspaceDocumentRetrievalResult } from "./workspace-document.js";
/** Approved, stored category value. Do not fuzzy-match or seed this category. */
export declare const CUSTOMER_FEEDBACK_CATEGORY = "Customer Feedback";
export declare class FounderWeeklyReviewEvidenceConflictError extends Error {
    readonly sourceId: string;
    readonly code = "duplicate_evidence_source_id_conflict";
    constructor(sourceId: string);
}
export interface DocumentVersionRow {
    documentId: bigint;
    documentTitle: string;
    documentCategory: string | null;
    versionId: number;
    versionNumber: number;
    uploadedBy: string | null;
    changelog: string | null;
    createdAt: Date;
}
export interface CustomerFeedbackChunkRow {
    documentId: bigint;
    versionId: number;
    versionNumber: number;
    documentTitle: string;
    documentCategory: string;
    createdAt: Date;
    chunkId: number | null;
    chunkContent: string | null;
    pageNumber: number | null;
}
export declare function mapCustomerFeedbackChunkToEvidenceItem(row: CustomerFeedbackChunkRow): FounderWeeklyReviewEvidenceItem | null;
export declare function mapDocumentVersionToEvidenceItem(row: DocumentVersionRow): FounderWeeklyReviewEvidenceItem;
export interface FounderWeeklyReviewEvidenceActor {
    externalUserId: string;
}
export interface BuildFounderWeeklyReviewEvidenceSnapshotInput {
    companyId: bigint;
    reportingPeriod: ReportingPeriod;
    workspaceTimezone: string;
    founderContext?: string;
    actor?: FounderWeeklyReviewEvidenceActor;
    /** Stable idempotency identity supplied by the request layer. */
    contextEntryId?: string;
    requestKey?: string;
    capturedAt?: Date;
    maxItems?: number;
}
export interface FounderWeeklyReviewEvidenceSourceResult {
    items: FounderWeeklyReviewEvidenceItem[];
    warnings: FounderWeeklyReviewEvidenceWarning[];
}
export interface VersionChunkLoadResult {
    state: "complete" | "partial" | "missing";
    chunks: VersionChunk[];
    warnings: string[];
}
/** Implemented in apps/web so pure feature logic never depends on Drizzle. */
export interface FounderWeeklyReviewDocumentChangeStore {
    /**
     * Only what the period can diff: in-window versions plus one predecessor
     * per touched document. Asking for all history before the period end made
     * the cost scale with the workspace rather than with the reporting period.
     */
    listVersionsForReportingPeriod(companyId: bigint, startInclusive: Date, endExclusive: Date): Promise<DocumentVersionForComparison[]>;
    /** Keyed `${documentId}:${versionId}`; a missing entry means inaccessible. */
    getDocumentChunksForVersions(input: {
        companyId: bigint;
        versions: readonly {
            documentId: bigint;
            versionId: number;
        }[];
    }): Promise<Map<string, VersionChunkLoadResult>>;
}
export declare function versionChunkKey(documentId: bigint, versionId: number): string;
export type FounderWeeklyReviewDocumentChangeSource = {
    kind: "computed";
    store: FounderWeeklyReviewDocumentChangeStore;
} | {
    kind: "legacy";
} | {
    kind: "unconfigured";
};
export interface FounderWeeklyReviewWorkspaceDocumentStore {
    retrieveRelevantCurrentDocumentChunks(input: WorkspaceDocumentRetrievalInput): Promise<WorkspaceDocumentRetrievalResult>;
}
export declare class FounderWeeklyReviewEvidenceService {
    private readonly db;
    private readonly now;
    private readonly documentChangeSource;
    private readonly workspaceDocumentStore?;
    constructor(db?: DbClient, now?: () => Date, documentChangeSource?: FounderWeeklyReviewDocumentChangeSource, workspaceDocumentStore?: FounderWeeklyReviewWorkspaceDocumentStore | undefined);
    collectDocumentChangeEvidence(companyId: bigint, startInclusive: Date, endExclusive: Date): Promise<FounderWeeklyReviewEvidenceItem[]>;
    private collectDocumentChangeEvidenceResult;
    collectCustomerFeedbackEvidence(companyId: bigint, startInclusive: Date, endExclusive: Date): Promise<FounderWeeklyReviewEvidenceSourceResult>;
    collectFounderContextEvidence(input: Pick<BuildFounderWeeklyReviewEvidenceSnapshotInput, "founderContext" | "actor" | "contextEntryId" | "requestKey">): FounderWeeklyReviewEvidenceSourceResult;
    collectWorkspaceDocumentEvidence(companyId: bigint, founderContext: string | undefined): Promise<FounderWeeklyReviewEvidenceSourceResult>;
    collectFounderWeeklyReviewEvidence(input: BuildFounderWeeklyReviewEvidenceSnapshotInput): Promise<FounderWeeklyReviewEvidenceSnapshot>;
    buildEvidenceSnapshot(input: BuildFounderWeeklyReviewEvidenceSnapshotInput): Promise<FounderWeeklyReviewEvidenceSnapshot>;
}
export declare function dedupeEvidenceItems(items: FounderWeeklyReviewEvidenceItem[]): FounderWeeklyReviewEvidenceItem[];
export declare function orderEvidenceItems(items: FounderWeeklyReviewEvidenceItem[]): FounderWeeklyReviewEvidenceItem[];
export declare function dedupeWarnings(warnings: FounderWeeklyReviewEvidenceWarning[]): FounderWeeklyReviewEvidenceWarning[];
//# sourceMappingURL=evidence-service.d.ts.map