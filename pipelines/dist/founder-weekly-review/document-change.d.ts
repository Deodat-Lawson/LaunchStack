import type { FounderWeeklyReviewEvidenceItem } from "./contracts.js";
export type DocumentVersionForComparison = {
    documentId: bigint;
    documentTitle: string;
    documentCategory: string | null;
    versionId: number;
    versionNumber: number;
    createdAt: Date;
    changelog: string | null;
};
export type VersionPair = {
    documentId: bigint;
    documentTitle: string;
    documentCategory: string | null;
    previousVersionId: number;
    previousVersionNumber: number;
    previousCreatedAt: Date;
    currentVersionId: number;
    currentVersionNumber: number;
    currentCreatedAt: Date;
    currentChangelog: string | null;
};
export type VersionChunk = {
    chunkId: number;
    content: string;
    contentHash: string | null;
    structureId: bigint | null;
    structurePath: string | null;
    structureTitle: string | null;
    structureOrdering: number | null;
    pageNumber: number | null;
    lineStart: number | null;
    lineEnd: number | null;
    documentId: bigint;
    versionId: bigint;
};
export type ChunkAlignment = {
    changeType: "added" | "removed" | "modified" | "unchanged";
    previousChunk?: VersionChunk;
    currentChunk?: VersionChunk;
    alignmentMethod: "content_hash" | "structure_path" | "section_title" | "structural_position" | "text_similarity" | "unmatched";
    similarityScore?: number;
};
/** Select only adjacent pairs whose current version is in the reporting period. */
export declare function selectVersionPairsForReportingPeriod(versions: readonly DocumentVersionForComparison[], startInclusive: Date, endExclusive: Date): VersionPair[];
/** Deterministic one-to-one alignment without embeddings or model calls. */
export declare function alignVersionChunks(previousChunks: readonly VersionChunk[], currentChunks: readonly VersionChunk[]): ChunkAlignment[];
export declare function buildDocumentChangeEvidence(pair: VersionPair, alignments: readonly ChunkAlignment[]): FounderWeeklyReviewEvidenceItem[];
//# sourceMappingURL=document-change.d.ts.map