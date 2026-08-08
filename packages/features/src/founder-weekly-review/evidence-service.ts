import {
    FOUNDER_WEEKLY_REVIEW_EVIDENCE_SCHEMA_VERSION,
    FounderWeeklyReviewEvidenceSnapshotSchema,
    type FounderWeeklyReviewEvidenceItem,
    type FounderWeeklyReviewEvidenceSnapshot,
    type FounderWeeklyReviewEvidenceWarning,
    type DocumentChangeAuditSnapshot,
    type ReportingPeriod,
} from "./contracts";
import { resolveReportingPeriodBounds } from "./reporting-period";
import { and, asc, eq, gte, lt } from "drizzle-orm";
import { getDb, type DbClient } from "@launchstack/core/db";
import {
    document,
    documentContextChunks,
    documentVersions,
} from "@launchstack/core/db/schema";
import {
    alignVersionChunks,
    selectVersionPairsForReportingPeriod,
    type DocumentChangePairInput,
    type DocumentVersionForComparison,
    type VersionChunk,
} from "./document-change";
import {
    materializeDocumentChangesWithAnalyzer,
    type DocumentChangeMaterialityAnalyzer,
} from "./document-change-materiality-analyzer";
import type { DeterministicMaterialChangeDiagnostics } from "./document-change-materiality";
import {
    buildWorkspaceDocumentEvidence,
    normalizeFounderContextRetrievalQuery,
    type WorkspaceDocumentRetrievalInput,
    type WorkspaceDocumentRetrievalResult,
} from "./workspace-document";

/** Approved, stored category value. Do not fuzzy-match or seed this category. */
export const CUSTOMER_FEEDBACK_CATEGORY = "Customer Feedback";
const MAX_SNAPSHOT_ITEMS = 500;
const MAX_ITEMS_PER_SOURCE = 250;
const MAX_EXCERPT_LENGTH = 4000;
const MAX_WARNINGS = 100;

function normalizeText(value: string | null | undefined): string | null {
    const trimmed = value?.replace(/\s+/g, " ").trim();
    return trimmed ? trimmed : null;
}

function boundExcerpt(value: string): { excerpt: string; truncated: boolean } {
    return value.length <= MAX_EXCERPT_LENGTH
        ? { excerpt: value, truncated: false }
        : { excerpt: value.slice(0, MAX_EXCERPT_LENGTH), truncated: true };
}

function warning(code: string, message: string, sourceType?: FounderWeeklyReviewEvidenceItem["sourceType"]): FounderWeeklyReviewEvidenceWarning {
    return { code, message: message.slice(0, 512), ...(sourceType ? { sourceType } : {}) };
}

export class FounderWeeklyReviewEvidenceConflictError extends Error {
    readonly code = "duplicate_evidence_source_id_conflict";
    constructor(readonly sourceId: string) {
        super(`Conflicting evidence items share sourceId: ${sourceId}`);
    }
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

export function mapCustomerFeedbackChunkToEvidenceItem(
    row: CustomerFeedbackChunkRow
): FounderWeeklyReviewEvidenceItem | null {
    const content = row.chunkContent?.trim();
    if (!content || row.chunkId === null) return null;
    const bounded = boundExcerpt(content);
    return {
        sourceType: "customer_feedback",
        sourceId: `customer_feedback:doc:${row.documentId}:version:${row.versionId}:section:${row.chunkId}`,
        title: row.documentTitle,
        sourceTimestamp: row.createdAt.toISOString(),
        excerpt: bounded.excerpt,
        workspaceDeepLink: `/employer/documents/viewer?docId=${row.documentId}`,
        metadata: {
            documentId: row.documentId.toString(),
            documentVersionId: row.versionId,
            sectionId: row.chunkId,
            versionNumber: row.versionNumber,
            documentCategory: row.documentCategory,
            pageNumber: row.pageNumber,
            excerptTruncated: bounded.truncated,
        },
    };
}

export function mapDocumentVersionToEvidenceItem(row: DocumentVersionRow): FounderWeeklyReviewEvidenceItem {
    const changelog = normalizeText(row.changelog);
    const bounded = changelog ? boundExcerpt(changelog) : null;
    return {
        sourceType: "document_change",
        sourceId: `document_change:doc:${row.documentId}:version:${row.versionId}`,
        title: row.documentTitle,
        sourceTimestamp: row.createdAt.toISOString(),
        excerpt: bounded?.excerpt ?? `Version ${row.versionNumber} uploaded`,
        workspaceDeepLink: `/employer/documents/viewer?docId=${row.documentId}`,
        metadata: {
            documentId: row.documentId.toString(), documentVersionId: row.versionId,
            versionNumber: row.versionNumber, documentCategory: row.documentCategory,
            uploadedBy: row.uploadedBy, hasChangelog: changelog !== null,
            changelogTruncated: bounded?.truncated ?? false,
        },
    };
}

export interface FounderWeeklyReviewEvidenceActor { externalUserId: string }
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
    documentChangeAudit?: DocumentChangeAuditSnapshot;
}

/** Implemented in apps/web so pure feature logic never depends on Drizzle. */
export interface FounderWeeklyReviewDocumentChangeStore {
    listVersionsBeforePeriodEnd(companyId: bigint, endExclusive: Date): Promise<DocumentVersionForComparison[]>;
    getDocumentChunksForVersion(input: { companyId: bigint; documentId: bigint; versionId: number }): Promise<
        { state: "complete" | "partial" | "missing"; chunks: VersionChunk[]; warnings: string[] }
    >;
}

export type FounderWeeklyReviewDocumentChangeSource =
    | { kind: "computed"; store: FounderWeeklyReviewDocumentChangeStore }
    | { kind: "legacy" }
    | { kind: "unconfigured" };

export interface FounderWeeklyReviewWorkspaceDocumentStore {
    retrieveRelevantCurrentDocumentChunks(input: WorkspaceDocumentRetrievalInput): Promise<WorkspaceDocumentRetrievalResult>;
}

export class FounderWeeklyReviewEvidenceService {
    constructor(
        private readonly db: DbClient = getDb(),
        private readonly now: () => Date = () => new Date(),
        private readonly documentChangeSource: FounderWeeklyReviewDocumentChangeSource = { kind: "unconfigured" },
        private readonly workspaceDocumentStore?: FounderWeeklyReviewWorkspaceDocumentStore,
        private readonly documentChangeMaterialityAnalyzer?: DocumentChangeMaterialityAnalyzer,
        private readonly onDocumentChangeDiagnostics?: (diagnostics: DeterministicMaterialChangeDiagnostics) => void,
    ) {}

    async collectDocumentChangeEvidence(companyId: bigint, startInclusive: Date, endExclusive: Date): Promise<FounderWeeklyReviewEvidenceItem[]> {
        return (await this.collectDocumentChangeEvidenceResult(companyId, startInclusive, endExclusive)).items;
    }

    private async collectDocumentChangeEvidenceResult(companyId: bigint, startInclusive: Date, endExclusive: Date): Promise<FounderWeeklyReviewEvidenceSourceResult> {
        if (this.documentChangeSource.kind === "computed") {
            const store = this.documentChangeSource.store;
            const versions = await store.listVersionsBeforePeriodEnd(companyId, endExclusive);
            const pairs = selectVersionPairsForReportingPeriod(versions, startInclusive, endExclusive);
            const pairInputs: DocumentChangePairInput[] = [];
            const warnings: FounderWeeklyReviewEvidenceWarning[] = [];
            for (const pair of pairs) {
                const [previous, current] = await Promise.all([
                    store.getDocumentChunksForVersion({ companyId, documentId: pair.documentId, versionId: pair.previousVersionId }),
                    store.getDocumentChunksForVersion({ companyId, documentId: pair.documentId, versionId: pair.currentVersionId }),
                ]);
                if (previous.state === "missing" || current.state === "missing") {
                    warnings.push(warning("document_change_chunks_missing", "A version pair could not be compared because processed historical chunks are missing.", "document_change"));
                    continue;
                }
                if (previous.state === "partial" || current.state === "partial") {
                    warnings.push(warning("document_change_chunks_partial", "A version pair was compared with partial chunk provenance.", "document_change"));
                }
                pairInputs.push({ pair, alignments: alignVersionChunks(previous.chunks, current.chunks) });
            }
            const materialized = await materializeDocumentChangesWithAnalyzer(
                pairInputs,
                this.documentChangeMaterialityAnalyzer,
            );
            this.onDocumentChangeDiagnostics?.(materialized.diagnostics);
            const items = [...materialized.items];
            warnings.push(...materialized.warnings.map((item) => warning(item.code, item.message, "document_change")));
            const pairedCurrentVersionIds = new Set(pairs.map((pair) => pair.currentVersionId));
            const inPeriodWithNoPair = versions.some((version) =>
                version.createdAt >= startInclusive
                && version.createdAt < endExclusive
                && !pairedCurrentVersionIds.has(version.versionId)
            );
            if (inPeriodWithNoPair) warnings.push(warning("document_change_baseline_missing", "An in-period document version has no predecessor, so no content diff was generated.", "document_change"));
            const ordered = orderEvidenceItems(dedupeEvidenceItems(items));
            if (ordered.length > MAX_ITEMS_PER_SOURCE) warnings.push(warning("document_change_truncated", "Document change evidence was truncated to the per-source limit.", "document_change"));
            return { items: ordered.slice(0, MAX_ITEMS_PER_SOURCE), warnings, documentChangeAudit: materialized.audit };
        }
        if (this.documentChangeSource.kind !== "legacy") {
            return { items: [], warnings: [warning("document_change_source_unconfigured", "Document-change collection requires the explicit computed-diff source.", "document_change")] };
        }
        const rows = await this.db.select({
            documentId: documentVersions.documentId, documentTitle: document.title,
            documentCategory: document.category, versionId: documentVersions.id,
            versionNumber: documentVersions.versionNumber, uploadedBy: documentVersions.uploadedBy,
            changelog: documentVersions.changelog, createdAt: documentVersions.createdAt,
        }).from(documentVersions).innerJoin(document, eq(document.id, documentVersions.documentId))
            .where(and(gte(documentVersions.createdAt, startInclusive), lt(documentVersions.createdAt, endExclusive), eq(document.companyId, companyId)))
            .orderBy(asc(documentVersions.createdAt), asc(documentVersions.id)).limit(MAX_ITEMS_PER_SOURCE + 1);
        return {
            items: rows.slice(0, MAX_ITEMS_PER_SOURCE).map(mapDocumentVersionToEvidenceItem),
            warnings: rows.length > MAX_ITEMS_PER_SOURCE
                ? [warning("document_change_truncated", "Document change evidence was truncated to the per-source limit.", "document_change")]
                : [],
        };
    }

    async collectCustomerFeedbackEvidence(companyId: bigint, startInclusive: Date, endExclusive: Date): Promise<FounderWeeklyReviewEvidenceSourceResult> {
        const rows = await this.db.select({
            documentId: documentVersions.documentId, versionId: documentVersions.id,
            versionNumber: documentVersions.versionNumber, documentTitle: document.title,
            documentCategory: document.category, createdAt: documentVersions.createdAt,
            chunkId: documentContextChunks.id,
            chunkContent: documentContextChunks.content,
            pageNumber: documentContextChunks.pageNumber,
        }).from(documentVersions).innerJoin(document, eq(document.id, documentVersions.documentId))
            .leftJoin(documentContextChunks, and(eq(documentContextChunks.documentId, documentVersions.documentId), eq(documentContextChunks.versionId, documentVersions.id)))
            .where(and(gte(documentVersions.createdAt, startInclusive), lt(documentVersions.createdAt, endExclusive), eq(document.companyId, companyId), eq(document.category, CUSTOMER_FEEDBACK_CATEGORY)))
            .orderBy(asc(documentVersions.createdAt), asc(documentVersions.id), asc(documentContextChunks.id)).limit(MAX_ITEMS_PER_SOURCE + 1);
        if (rows.length === 0) return { items: [], warnings: [warning("customer_feedback_unavailable", "No Customer Feedback documents were available for this reporting period.", "customer_feedback")] };
        const mapped = rows.map(mapCustomerFeedbackChunkToEvidenceItem);
        const items = mapped.filter((item): item is FounderWeeklyReviewEvidenceItem => item !== null);
        const warnings: FounderWeeklyReviewEvidenceWarning[] = [];
        if (items.length === 0) warnings.push(warning("customer_feedback_missing_sections", "Customer Feedback document versions had no processed, citeable sections.", "customer_feedback"));
        else if (items.length < rows.length) warnings.push(warning("customer_feedback_missing_sections", "Some Customer Feedback sections had no citeable content.", "customer_feedback"));
        if (rows.length > MAX_ITEMS_PER_SOURCE) warnings.push(warning("customer_feedback_truncated", "Customer Feedback evidence was truncated to the per-source limit.", "customer_feedback"));
        return { items: items.slice(0, MAX_ITEMS_PER_SOURCE), warnings };
    }

    collectFounderContextEvidence(input: Pick<BuildFounderWeeklyReviewEvidenceSnapshotInput, "founderContext" | "actor" | "contextEntryId" | "requestKey">): FounderWeeklyReviewEvidenceSourceResult {
        const context = normalizeText(input.founderContext);
        if (!context) return { items: [], warnings: [] };
        const entryId = input.contextEntryId ?? input.requestKey;
        if (!entryId) throw new Error("Founder context requires a stable contextEntryId or requestKey");
        if (entryId.length > 230) throw new Error("Founder context entry identity is too long");
        if (!input.actor) throw new Error("Founder context requires an authenticated actor");
        const bounded = boundExcerpt(context);
        return { items: [{ sourceType: "founder_context", sourceId: `founder_context:entry:${entryId}`,
            title: "Founder context", excerpt: bounded.excerpt,
            metadata: { enteredBy: input.actor.externalUserId, provenance: "request_time_founder_input", excerptTruncated: bounded.truncated } }], warnings: [] };
    }

    async collectWorkspaceDocumentEvidence(companyId: bigint, founderContext: string | undefined): Promise<FounderWeeklyReviewEvidenceSourceResult> {
        const query = normalizeFounderContextRetrievalQuery(founderContext);
        if (!query || !this.workspaceDocumentStore) return { items: [], warnings: [] };
        const result = await this.workspaceDocumentStore.retrieveRelevantCurrentDocumentChunks({ companyId, founderContext: query });
        if (result.state === "success") return { items: buildWorkspaceDocumentEvidence(result.hits), warnings: [] };
        if (result.state === "empty") return { items: [], warnings: [] };
        return { items: [], warnings: result.warnings.slice(0, MAX_WARNINGS).map((code) => warning(code, "Founder Context workspace retrieval was unavailable.", "workspace_document")) };
    }

    async collectFounderWeeklyReviewEvidence(input: BuildFounderWeeklyReviewEvidenceSnapshotInput): Promise<FounderWeeklyReviewEvidenceSnapshot> {
        return this.buildEvidenceSnapshot(input);
    }

    async buildEvidenceSnapshot(input: BuildFounderWeeklyReviewEvidenceSnapshotInput): Promise<FounderWeeklyReviewEvidenceSnapshot> {
        const { startInclusive, endExclusive } = resolveReportingPeriodBounds(input.reportingPeriod, input.workspaceTimezone);
        const documentChanges = await this.collectDocumentChangeEvidenceResult(input.companyId, startInclusive, endExclusive);
        const feedback = await this.collectCustomerFeedbackEvidence(input.companyId, startInclusive, endExclusive);
        const founderContext = this.collectFounderContextEvidence(input);
        const workspaceDocuments = await this.collectWorkspaceDocumentEvidence(input.companyId, input.founderContext);
        const sourceResults: FounderWeeklyReviewEvidenceSourceResult[] = [documentChanges, feedback, founderContext, workspaceDocuments];
        const items = orderEvidenceItems(dedupeEvidenceItems(sourceResults.flatMap((result) => result.items)));
        const requestedMax = input.maxItems ?? MAX_SNAPSHOT_ITEMS;
        const maxItems = Math.max(0, Math.min(MAX_SNAPSHOT_ITEMS, requestedMax));
        const warnings = dedupeWarnings(sourceResults.flatMap((result) => result.warnings));
        if (items.length > maxItems) warnings.push(warning("evidence_snapshot_truncated", "Evidence snapshot was truncated to its configured maximum."));
        const selectedItems = items.slice(0, maxItems);
        const selectedSourceIds = new Set(selectedItems.map(item => item.sourceId));
        const collectedAudit = documentChanges.documentChangeAudit ?? { schemaVersion: "document-change-audit/v1" as const, rawChanges: [], groups: [] };
        const documentChangeAudit: DocumentChangeAuditSnapshot = {
            ...collectedAudit,
            groups: collectedAudit.groups.map(group => ({
                ...group,
                evidenceSourceId: group.evidenceSourceId && selectedSourceIds.has(group.evidenceSourceId) ? group.evidenceSourceId : null,
            })),
        };
        return FounderWeeklyReviewEvidenceSnapshotSchema.parse({ schemaVersion: FOUNDER_WEEKLY_REVIEW_EVIDENCE_SCHEMA_VERSION,
            capturedAt: (input.capturedAt ?? this.now()).toISOString(), reportingPeriod: input.reportingPeriod,
            workspaceTimezone: input.workspaceTimezone, items: selectedItems, sourceWarnings: dedupeWarnings(warnings).slice(0, MAX_WARNINGS),
            documentChangeAudit });
    }
}

function canonicalItem(item: FounderWeeklyReviewEvidenceItem): string { return JSON.stringify(item); }
export function dedupeEvidenceItems(items: FounderWeeklyReviewEvidenceItem[]): FounderWeeklyReviewEvidenceItem[] {
    const bySourceId = new Map<string, FounderWeeklyReviewEvidenceItem>();
    for (const item of items) {
        const existing = bySourceId.get(item.sourceId);
        if (!existing) { bySourceId.set(item.sourceId, item); continue; }
        if (canonicalItem(existing) !== canonicalItem(item)) throw new FounderWeeklyReviewEvidenceConflictError(item.sourceId);
    }
    return [...bySourceId.values()];
}

function compareOrdinal(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }
function evidenceMetadataText(item: FounderWeeklyReviewEvidenceItem, key: string): string {
    const value = item.metadata[key];
    return typeof value === "string" || typeof value === "number" ? String(value) : "";
}
function compareDocumentChangeEvidence(a: FounderWeeklyReviewEvidenceItem, b: FounderWeeklyReviewEvidenceItem): number {
    if (a.sourceType !== "document_change" || b.sourceType !== "document_change") return 0;
    const aDocument = evidenceMetadataText(a, "documentId"); const bDocument = evidenceMetadataText(b, "documentId");
    const document = /^\d+$/.test(aDocument) && /^\d+$/.test(bDocument)
        ? (BigInt(aDocument) < BigInt(bDocument) ? -1 : BigInt(aDocument) > BigInt(bDocument) ? 1 : 0)
        : compareOrdinal(aDocument, bDocument);
    if (document !== 0) return document;
    for (const key of ["previousVersionId", "currentVersionId", "structureOrdering", "pageNumber", "lineStart"] as const) {
        const left = Number(evidenceMetadataText(a, key)); const right = Number(evidenceMetadataText(b, key));
        if (Number.isFinite(left) && Number.isFinite(right) && left !== right) return left - right;
    }
    return compareOrdinal(evidenceMetadataText(a, "structurePath"), evidenceMetadataText(b, "structurePath"));
}
export function orderEvidenceItems(items: FounderWeeklyReviewEvidenceItem[]): FounderWeeklyReviewEvidenceItem[] {
    return [...items].sort((a, b) => compareOrdinal(a.sourceTimestamp ?? "", b.sourceTimestamp ?? "") || compareOrdinal(a.sourceType, b.sourceType) || compareDocumentChangeEvidence(a, b) || compareOrdinal(a.sourceId, b.sourceId));
}

export function dedupeWarnings(warnings: FounderWeeklyReviewEvidenceWarning[]): FounderWeeklyReviewEvidenceWarning[] {
    const unique = new Map<string, FounderWeeklyReviewEvidenceWarning>();
    for (const item of warnings) unique.set(`${item.code}\u0000${item.sourceType ?? ""}\u0000${item.message}`, item);
    return [...unique.values()].sort((a, b) => compareOrdinal(a.code, b.code) || compareOrdinal(a.sourceType ?? "", b.sourceType ?? "") || compareOrdinal(a.message, b.message));
}
