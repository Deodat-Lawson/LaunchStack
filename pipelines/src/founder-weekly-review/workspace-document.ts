import type { FounderWeeklyReviewEvidenceItem } from "./contracts";

export const MAX_WORKSPACE_RETRIEVAL_CANDIDATES = 12;
export const MAX_WORKSPACE_EVIDENCE_ITEMS = 8;
export const MAX_WORKSPACE_EVIDENCE_PER_DOCUMENT = 2;
export const MAX_WORKSPACE_EXCERPT_LENGTH = 4000;

export type WorkspaceDocumentRetrievalInput = {
    companyId: bigint;
    founderContext: string;
    topK?: number;
};
export type WorkspaceDocumentHit = {
    documentId: bigint;
    documentTitle: string;
    versionId: bigint;
    contextChunkId: number;
    retrievalChunkId?: number;
    content: string;
    similarityScore: number;
    structureId?: bigint | null;
    structurePath?: string | null;
    structureTitle?: string | null;
    pageNumber?: number | null;
    lineStart?: number | null;
    lineEnd?: number | null;
};
export type WorkspaceDocumentRetrievalResult =
    | { state: "success"; hits: WorkspaceDocumentHit[] }
    | { state: "empty"; hits: [] }
    | { state: "unavailable"; hits: []; warnings: string[] };

// Empty-after-trim collapses to null as well, so this cannot be `??`.
const normalize = (value: string | null | undefined) => {
    const collapsed = value?.replace(/\s+/g, " ").trim();
    return collapsed === undefined || collapsed === "" ? null : collapsed;
};
const bound = (value: string, max: number) =>
    value.length <= max ? value : `${value.slice(0, max - 1)}…`;
const compareBigInt = (left: bigint, right: bigint) => (left < right ? -1 : left > right ? 1 : 0);
const compareHits = (a: WorkspaceDocumentHit, b: WorkspaceDocumentHit) =>
    b.similarityScore - a.similarityScore ||
    compareBigInt(a.documentId, b.documentId) ||
    compareBigInt(a.versionId, b.versionId) ||
    a.contextChunkId - b.contextChunkId;

export function normalizeFounderContextRetrievalQuery(
    founderContext: string | null | undefined
): string | null {
    const normalized = normalize(founderContext);
    return normalized ? bound(normalized, 4000) : null;
}

/** Deterministically deduplicate, diversify, and cap provider/database hits. */
export function selectWorkspaceDocumentHits(
    hits: readonly WorkspaceDocumentHit[]
): WorkspaceDocumentHit[] {
    const selected: WorkspaceDocumentHit[] = [];
    const contexts = new Set<string>();
    const perDocument = new Map<string, number>();
    for (const hit of [...hits]
        .filter(hit => normalize(hit.content) && Number.isFinite(hit.similarityScore))
        .sort(compareHits)) {
        const contextKey = `${hit.documentId}:${hit.versionId}:${hit.contextChunkId}`;
        if (contexts.has(contextKey)) continue;
        const count = perDocument.get(hit.documentId.toString()) ?? 0;
        if (count >= MAX_WORKSPACE_EVIDENCE_PER_DOCUMENT) continue;
        contexts.add(contextKey);
        perDocument.set(hit.documentId.toString(), count + 1);
        selected.push(hit);
        if (selected.length >= MAX_WORKSPACE_EVIDENCE_ITEMS) break;
    }
    return selected;
}

export function buildWorkspaceDocumentEvidence(
    hits: readonly WorkspaceDocumentHit[]
): FounderWeeklyReviewEvidenceItem[] {
    return selectWorkspaceDocumentHits(hits).map(hit => ({
        sourceType: "workspace_document" as const,
        sourceId: `workspace_document:doc:${hit.documentId}:version:${hit.versionId}:chunk:${hit.contextChunkId}`,
        title: hit.documentTitle,
        excerpt: bound(normalize(hit.content)!, MAX_WORKSPACE_EXCERPT_LENGTH),
        workspaceDeepLink: `/employer/documents/viewer?docId=${hit.documentId}`,
        metadata: {
            documentId: hit.documentId.toString(),
            documentVersionId: hit.versionId.toString(),
            chunkId: hit.contextChunkId,
            retrievalChunkId: hit.retrievalChunkId ?? null,
            retrievalReason: "founder_context_relevance",
            similarityScore: hit.similarityScore,
            structureId: hit.structureId?.toString() ?? null,
            structurePath: hit.structurePath ? bound(hit.structurePath, 512) : null,
            structureTitle: hit.structureTitle ? bound(hit.structureTitle, 512) : null,
            pageNumber: hit.pageNumber ?? null,
            lineStart: hit.lineStart ?? null,
            lineEnd: hit.lineEnd ?? null,
        },
    }));
}
