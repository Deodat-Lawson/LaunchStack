import type { FounderWeeklyReviewEvidenceItem } from "./contracts.js";
export declare const MAX_WORKSPACE_RETRIEVAL_CANDIDATES = 12;
export declare const MAX_WORKSPACE_EVIDENCE_ITEMS = 8;
export declare const MAX_WORKSPACE_EVIDENCE_PER_DOCUMENT = 2;
export declare const MAX_WORKSPACE_EXCERPT_LENGTH = 4000;
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
    | {
          state: "success";
          hits: WorkspaceDocumentHit[];
      }
    | {
          state: "empty";
          hits: [];
      }
    | {
          state: "unavailable";
          hits: [];
          warnings: string[];
      };
export declare function normalizeFounderContextRetrievalQuery(
    founderContext: string | null | undefined
): string | null;
/** Deterministically deduplicate, diversify, and cap provider/database hits. */
export declare function selectWorkspaceDocumentHits(
    hits: readonly WorkspaceDocumentHit[]
): WorkspaceDocumentHit[];
export declare function buildWorkspaceDocumentEvidence(
    hits: readonly WorkspaceDocumentHit[]
): FounderWeeklyReviewEvidenceItem[];
//# sourceMappingURL=workspace-document.d.ts.map
