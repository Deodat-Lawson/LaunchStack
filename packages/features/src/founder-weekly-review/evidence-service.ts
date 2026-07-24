import {
    FOUNDER_WEEKLY_REVIEW_EVIDENCE_SCHEMA_VERSION,
    FounderWeeklyReviewEvidenceSnapshotSchema,
    type FounderWeeklyReviewEvidenceItem,
    type FounderWeeklyReviewEvidenceSnapshot,
    type ReportingPeriod,
} from "./contracts";
import { resolveReportingPeriodBounds } from "./reporting-period";
import { and, asc, eq, gte, lt } from "drizzle-orm";
import { getDb, type DbClient } from "@launchstack/core/db";
import { document, documentVersions } from "@launchstack/core/db/schema";

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
    row: DocumentVersionRow
): FounderWeeklyReviewEvidenceItem {
    const changelog = normalizeText(row.changelog);

    return {
        sourceType: "document_change",
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
                    eq(document.companyId, companyId)
                )
            )
            .orderBy(asc(documentVersions.createdAt), asc(documentVersions.id));
        return rows.map((row) => mapDocumentVersionToEvidenceItem(row));
    }

    async buildEvidenceSnapshot(
        input: BuildFounderWeeklyReviewEvidenceSnapshotInput
    ): Promise<FounderWeeklyReviewEvidenceSnapshot> {
        const { startInclusive, endExclusive } = resolveReportingPeriodBounds(
            input.reportingPeriod,
            input.workspaceTimezone
        );

        // only document_change exists right now
        const collected = await this.collectDocumentChangeEvidence(
            input.companyId,
            startInclusive,
            endExclusive
        );

        // more evidence can be merged later
        const merged = [...collected];

        // 4. Drop exact duplicates, keep distinct citations. (AC #5)
        const deduped = dedupeEvidenceItems(merged);

        // 5. Deterministic order, then cap at the schema's limit.
        const maxItems = input.maxItems ?? 500;
        const items = orderEvidenceItems(deduped).slice(0, maxItems);

        // 6. Wrap in the envelope. Empty `items` is valid — an empty/partial
        //    workspace returns a pack rather than throwing. (AC #6)
        const snapshot = {
            schemaVersion: FOUNDER_WEEKLY_REVIEW_EVIDENCE_SCHEMA_VERSION,
            capturedAt: (input.capturedAt ?? new Date()).toISOString(),
            reportingPeriod: input.reportingPeriod,
            workspaceTimezone: input.workspaceTimezone,
            items,
            sourceWarnings: [],
        };

        // 7. Validate before returning — a malformed pack never leaves here.
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