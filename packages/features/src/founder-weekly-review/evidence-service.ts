import {
    FOUNDER_WEEKLY_REVIEW_EVIDENCE_SCHEMA_VERSION,
    FounderWeeklyReviewEvidenceSnapshotSchema,
    type FounderWeeklyReviewEvidenceItem,
    type FounderWeeklyReviewEvidenceSnapshot,
    type ReportingPeriod,
} from "./contracts";
import { resolveReportingPeriodBounds } from "./reporting-period";
import { and, asc, eq, gte, lt, ne } from "drizzle-orm";
import { getDb, type DbClient } from "@launchstack/core/db";
import { document, documentVersions } from "@launchstack/core/db/schema";

const CUSTOMER_FEEDBACK_CATEGORY_NAME = "customer feedback"

function normalizeText(value: string | null | undefined): string | null {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
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

export function mapDocumentVersionToEvidenceItem(
    row: DocumentVersionRow,
    sourceType: FounderWeeklyReviewEvidenceItem["sourceType"] = "document_change"
): FounderWeeklyReviewEvidenceItem {
    const changelog = normalizeText(row.changelog);

    return {
        sourceType: sourceType,
        sourceId: `document-version:${row.documentId}:${row.versionNumber}`,
        title: row.documentTitle,
        sourceTimestamp: row.createdAt.toISOString(),
        excerpt: changelog ?? `Version ${row.versionNumber} uploaded`,
        // canonicalUrl intentionally omitted: document.url is inconsistent across rows in document datatable
        // relative paths (/api/files/115), storage urls, local dev urls
        workspaceDeepLink: `/employer/documents/viewer?docId=${row.documentId}`,
        metadata: {
            documentId: row.documentId.toString(),
            versionId: row.versionId,
            versionNumber: row.versionNumber,
            documentCategory: row.documentCategory,
            uploadedBy: row.uploadedBy,
            hasChangelog: changelog !== null,
        },
    };
}

export interface BuildFounderWeeklyReviewEvidenceSnapshotInput {
    companyId: bigint;
    reportingPeriod: ReportingPeriod;
    workspaceTimezone: string;
    capturedAt?: Date;
    maxItems?: number;
}

export class FounderWeeklyReviewEvidenceService {
    constructor(private readonly db: DbClient = getDb()) {}

    async collectDocumentChangeEvidence(
        companyId: bigint,
        startInclusive: Date,
        endExclusive: Date,
    ): Promise<FounderWeeklyReviewEvidenceItem[]> {
        const rows = await this.db
            .select({
                documentId: documentVersions.documentId,
                documentTitle: document.title,
                documentCategory: document.category,
                versionId: documentVersions.id,
                versionNumber: documentVersions.versionNumber,
                uploadedBy: documentVersions.uploadedBy,
                changelog: documentVersions.changelog,
                createdAt: documentVersions.createdAt,
            })
            .from(documentVersions)
            .innerJoin(document, eq(document.id, documentVersions.documentId))
            .where(
                and(
                    gte(documentVersions.createdAt, startInclusive),
                    lt(documentVersions.createdAt, endExclusive),
                    eq(document.companyId, companyId),
                    ne(document.category, CUSTOMER_FEEDBACK_CATEGORY_NAME)
                )
            )
            .orderBy(asc(documentVersions.createdAt), asc(documentVersions.id));
        return rows.map((row) => mapDocumentVersionToEvidenceItem(row));
    }

    async collectCustomerFeedbackEvidence(
        companyId: bigint,
        startInclusive: Date,
        endExclusive: Date,
    ): Promise<FounderWeeklyReviewEvidenceItem[]> {
        const rows = await this.db
            .select({
                documentId: documentVersions.documentId,
                documentTitle: document.title,
                documentCategory: document.category,
                versionId: documentVersions.id,
                versionNumber: documentVersions.versionNumber,
                uploadedBy: documentVersions.uploadedBy,
                changelog: documentVersions.changelog,
                createdAt: documentVersions.createdAt,
            })
            .from(documentVersions)
            .innerJoin(document, eq(document.id, documentVersions.documentId))
            .where(
                and(
                    gte(documentVersions.createdAt, startInclusive),
                    lt(documentVersions.createdAt, endExclusive),
                    eq(document.companyId, companyId),
                    eq(document.category, CUSTOMER_FEEDBACK_CATEGORY_NAME)
                )
            )
            .orderBy(asc(documentVersions.createdAt), asc(documentVersions.id));
        return rows.map((row) => mapDocumentVersionToEvidenceItem(row, "customer_feedback"));
    }

    async buildEvidenceSnapshot(
        input: BuildFounderWeeklyReviewEvidenceSnapshotInput
    ): Promise<FounderWeeklyReviewEvidenceSnapshot> {
        const { startInclusive, endExclusive } = resolveReportingPeriodBounds(
            input.reportingPeriod,
            input.workspaceTimezone
        );

        const collectedDocumentChange = await this.collectDocumentChangeEvidence(
            input.companyId,
            startInclusive,
            endExclusive
        );
        const collectedCustomerFeedback = await this.collectCustomerFeedbackEvidence(
            input.companyId,
            startInclusive,
            endExclusive
        );

        // more evidence can be merged later
        const merged = [...collectedDocumentChange, ...collectedCustomerFeedback];

        const deduped = dedupeEvidenceItems(merged);

        const maxItems = input.maxItems ?? 500;
        const items = orderEvidenceItems(deduped).slice(0, maxItems);

        const snapshot = {
            schemaVersion: FOUNDER_WEEKLY_REVIEW_EVIDENCE_SCHEMA_VERSION,
            capturedAt: (input.capturedAt ?? new Date()).toISOString(),
            reportingPeriod: input.reportingPeriod,
            workspaceTimezone: input.workspaceTimezone,
            items,
            sourceWarnings: [],
        };

        return FounderWeeklyReviewEvidenceSnapshotSchema.parse(snapshot);
    }
}

export function dedupeEvidenceItems(
    items: FounderWeeklyReviewEvidenceItem[]
): FounderWeeklyReviewEvidenceItem[] {
    const seenIdentities = new Set<string>()

    return items.filter(item => {
        const identity = `${item.sourceType}:${item.sourceId}`

        if (seenIdentities.has(identity)) {
            return false
        }

        seenIdentities.add(identity)
        return true
    })
}

// order primarily based on createdAt timestamp, sourceId as tie breaker
export function orderEvidenceItems(
    items: FounderWeeklyReviewEvidenceItem[]
): FounderWeeklyReviewEvidenceItem[] {
    return [...items].sort((a, b) => {
        // if timestamp is missing use empty string
        const aTime = a.sourceTimestamp ?? "";
        const bTime = b.sourceTimestamp ?? "";
        if (aTime !== bTime) {
            return aTime.localeCompare(bTime);
        }

        const identityA = `${a.sourceType}:${a.sourceId}`;
        const identityB = `${b.sourceType}:${b.sourceId}`;
        return identityA.localeCompare(identityB);
    });
}