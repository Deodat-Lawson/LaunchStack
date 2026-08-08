import { and, asc, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { getDb, type DbClient } from "@launchstack/core/db";
import { document, documentContextChunks, documentStructure, documentVersions } from "@launchstack/core/db/schema";
import type { DocumentVersionForComparison, VersionChunk } from "@launchstack/features/founder-weekly-review";

export type VersionChunkLoad =
    | { state: "complete"; chunks: VersionChunk[]; warnings: string[] }
    | { state: "partial"; chunks: VersionChunk[]; warnings: string[] }
    | { state: "missing"; chunks: []; warnings: string[] };

export function versionChunkKey(documentId: bigint, versionId: number): string {
    return `${documentId.toString()}:${versionId}`;
}

const VERSION_COLUMNS = {
    documentId: documentVersions.documentId,
    documentTitle: document.title,
    documentCategory: document.category,
    versionId: documentVersions.id,
    versionNumber: documentVersions.versionNumber,
    createdAt: documentVersions.createdAt,
    changelog: documentVersions.changelog,
} as const;

/** App-side ownership-checked, explicit-version data access for weekly review diffs. */
export class FounderWeeklyReviewDocumentVersionStore {
    constructor(private readonly db: DbClient = getDb()) {}

    /**
     * The versions a reporting period can actually produce a diff from: every
     * version inside the window, plus the single most recent version before it
     * for each document the window touches.
     *
     * Loading all history before the period end instead is what made this
     * O(workspace) rather than O(period): a document with a thousand versions
     * contributed a thousand rows to build one pair.
     */
    async listVersionsForReportingPeriod(
        companyId: bigint,
        startInclusive: Date,
        endExclusive: Date,
    ): Promise<DocumentVersionForComparison[]> {
        const inPeriod = await this.db
            .select(VERSION_COLUMNS)
            .from(documentVersions)
            .innerJoin(document, eq(document.id, documentVersions.documentId))
            .where(
                and(
                    eq(document.companyId, companyId),
                    gte(documentVersions.createdAt, startInclusive),
                    lt(documentVersions.createdAt, endExclusive),
                ),
            )
            .orderBy(
                asc(documentVersions.createdAt),
                asc(documentVersions.versionNumber),
                asc(documentVersions.id),
            );

        const touchedDocumentIds = [...new Set(inPeriod.map((row) => row.documentId))];
        if (touchedDocumentIds.length === 0) return [];

        // One predecessor per document — the baseline each earliest in-period
        // version diffs against. DISTINCT ON needs the partition column first
        // in ORDER BY; the rest picks the latest row within it.
        const predecessors = await this.db
            .selectDistinctOn([documentVersions.documentId], VERSION_COLUMNS)
            .from(documentVersions)
            .innerJoin(document, eq(document.id, documentVersions.documentId))
            .where(
                and(
                    eq(document.companyId, companyId),
                    inArray(documentVersions.documentId, touchedDocumentIds),
                    lt(documentVersions.createdAt, startInclusive),
                ),
            )
            .orderBy(
                asc(documentVersions.documentId),
                desc(documentVersions.createdAt),
                desc(documentVersions.versionNumber),
                desc(documentVersions.id),
            );

        // Pairing re-sorts per document, so append order does not matter.
        return [...predecessors, ...inPeriod];
    }

    /**
     * Chunks for many versions in two queries rather than two per version.
     *
     * The previous shape ran an ownership check and a chunk query for each side
     * of each pair, so a period with fifty changed documents issued two hundred
     * round trips before any comparison started.
     */
    async getDocumentChunksForVersions(input: {
        companyId: bigint;
        versions: readonly { documentId: bigint; versionId: number }[];
    }): Promise<Map<string, VersionChunkLoad>> {
        const results = new Map<string, VersionChunkLoad>();
        const requested = [
            ...new Map(
                input.versions.map((version) => [
                    versionChunkKey(version.documentId, version.versionId),
                    version,
                ]),
            ).values(),
        ];
        if (requested.length === 0) return results;

        const owned = await this.db
            .select({
                versionId: documentVersions.id,
                documentId: documentVersions.documentId,
            })
            .from(documentVersions)
            .innerJoin(document, eq(document.id, documentVersions.documentId))
            .where(
                and(
                    eq(document.companyId, input.companyId),
                    inArray(
                        documentVersions.id,
                        requested.map((version) => version.versionId),
                    ),
                ),
            );

        const ownedKeys = new Set(
            owned.map((row) => versionChunkKey(row.documentId, row.versionId)),
        );
        for (const version of requested) {
            if (!ownedKeys.has(versionChunkKey(version.documentId, version.versionId))) {
                results.set(versionChunkKey(version.documentId, version.versionId), {
                    state: "missing",
                    chunks: [],
                    warnings: ["document_version_not_accessible"],
                });
            }
        }

        const ownedVersionIds = owned.map((row) => row.versionId);
        if (ownedVersionIds.length === 0) return results;

        const rows = await this.db
            .select({
                chunkId: documentContextChunks.id,
                content: documentContextChunks.content,
                contentHash: documentContextChunks.contentHash,
                structureId: documentContextChunks.structureId,
                structurePath: documentStructure.path,
                structureTitle: documentStructure.title,
                structureOrdering: documentStructure.ordering,
                pageNumber: documentContextChunks.pageNumber,
                lineStart: documentContextChunks.lineStart,
                lineEnd: documentContextChunks.lineEnd,
                documentId: documentContextChunks.documentId,
                versionId: documentContextChunks.versionId,
            })
            .from(documentContextChunks)
            .leftJoin(documentStructure, eq(documentContextChunks.structureId, documentStructure.id))
            .where(
                inArray(
                    documentContextChunks.versionId,
                    ownedVersionIds.map((versionId) => BigInt(versionId)),
                ),
            )
            .orderBy(
                asc(documentStructure.path),
                asc(documentContextChunks.pageNumber),
                asc(documentContextChunks.lineStart),
                asc(documentStructure.ordering),
                asc(documentContextChunks.id),
            );

        const byVersion = new Map<string, VersionChunk[]>();
        for (const row of rows) {
            if (row.versionId === null) continue;
            const key = versionChunkKey(row.documentId, Number(row.versionId));
            const group = byVersion.get(key) ?? [];
            group.push({ ...row, versionId: row.versionId });
            byVersion.set(key, group);
        }

        for (const row of owned) {
            const key = versionChunkKey(row.documentId, row.versionId);
            const chunks = byVersion.get(key);
            if (!chunks || chunks.length === 0) {
                results.set(key, { state: "missing", chunks: [], warnings: ["version_chunks_missing"] });
                continue;
            }
            const partial = chunks.some((chunk) => !chunk.contentHash || !chunk.structurePath);
            results.set(
                key,
                partial
                    ? { state: "partial", chunks, warnings: ["version_chunks_partial_provenance"] }
                    : { state: "complete", chunks, warnings: [] },
            );
        }

        return results;
    }
}
