import { and, asc, eq, lt } from "drizzle-orm";
import { getDb, type DbClient } from "@launchstack/core/db";
import { document, documentContextChunks, documentStructure, documentVersions } from "@launchstack/core/db/schema";
import type { DocumentVersionForComparison, VersionChunk } from "@launchstack/features/founder-weekly-review";

export type VersionChunkLoad =
    | { state: "complete"; chunks: VersionChunk[]; warnings: string[] }
    | { state: "partial"; chunks: VersionChunk[]; warnings: string[] }
    | { state: "missing"; chunks: []; warnings: string[] };

/** App-side ownership-checked, explicit-version data access for weekly review diffs. */
export class FounderWeeklyReviewDocumentVersionStore {
    constructor(private readonly db: DbClient = getDb()) {}

    async listVersionsBeforePeriodEnd(companyId: bigint, endExclusive: Date): Promise<DocumentVersionForComparison[]> {
        return this.db.select({ documentId: documentVersions.documentId, documentTitle: document.title, documentCategory: document.category,
            versionId: documentVersions.id, versionNumber: documentVersions.versionNumber, createdAt: documentVersions.createdAt, changelog: documentVersions.changelog })
            .from(documentVersions).innerJoin(document, eq(document.id, documentVersions.documentId))
            .where(and(eq(document.companyId, companyId), lt(documentVersions.createdAt, endExclusive)))
            .orderBy(asc(documentVersions.createdAt), asc(documentVersions.versionNumber), asc(documentVersions.id));
    }

    async getDocumentChunksForVersion(input: { companyId: bigint; documentId: bigint; versionId: number }): Promise<VersionChunkLoad> {
        const [ownedVersion] = await this.db.select({ id: documentVersions.id }).from(documentVersions)
            .innerJoin(document, eq(document.id, documentVersions.documentId))
            .where(and(eq(document.companyId, input.companyId), eq(documentVersions.id, input.versionId), eq(documentVersions.documentId, input.documentId))).limit(1);
        if (!ownedVersion) return { state: "missing", chunks: [], warnings: ["document_version_not_accessible"] };
        const rows = await this.db.select({ chunkId: documentContextChunks.id, content: documentContextChunks.content, contentHash: documentContextChunks.contentHash,
            structureId: documentContextChunks.structureId, structurePath: documentStructure.path, structureTitle: documentStructure.title, structureOrdering: documentStructure.ordering,
            pageNumber: documentContextChunks.pageNumber, lineStart: documentContextChunks.lineStart, lineEnd: documentContextChunks.lineEnd,
            documentId: documentContextChunks.documentId, versionId: documentContextChunks.versionId })
            .from(documentContextChunks).leftJoin(documentStructure, eq(documentContextChunks.structureId, documentStructure.id))
            .where(and(eq(documentContextChunks.documentId, input.documentId), eq(documentContextChunks.versionId, BigInt(input.versionId))))
            .orderBy(asc(documentStructure.path), asc(documentContextChunks.pageNumber), asc(documentContextChunks.lineStart), asc(documentStructure.ordering), asc(documentContextChunks.id));
        if (rows.length === 0) return { state: "missing", chunks: [], warnings: ["version_chunks_missing"] };
        const chunks = rows.map((row) => ({ ...row, versionId: row.versionId! }));
        const partial = chunks.some((chunk) => !chunk.contentHash || !chunk.structurePath);
        return partial ? { state: "partial", chunks, warnings: ["version_chunks_partial_provenance"] } : { state: "complete", chunks, warnings: [] };
    }
}
