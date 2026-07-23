import type { FounderWeeklyReviewEvidenceItem } from "./contracts";
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
}