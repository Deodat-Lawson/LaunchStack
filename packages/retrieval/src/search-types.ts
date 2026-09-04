/**
 * Retrieval types for the engine's own retrievers.
 *
 * Distinct from ./types, which defines the RagPort — the narrow boundary a
 * host implements. These are the richer types the retrievers themselves speak,
 * moved here from apps/web/src/lib/tools/rag/types.ts as part of inverting the
 * engine boundary (see REPOSITORY.md, "The boundary today").
 */

export type SearchScope = "document" | "company" | "multi-document";

export type RetrievalMethod =
    | "vector_ann"
    | "bm25"
    | "ensemble_rrf"
    | "ensemble_rrf_reranked"
    | "bm25_fallback"
    | "ann_hnsw"
    | "ann_ivf"
    | "ann_hybrid"
    | "ann_prefiltered"
    | "graph_traversal";

export interface BaseSearchMetadata {
    chunkId?: number;
    page?: number;
    documentId?: number;
    /**
     * The document version the chunk belongs to (documents.current_version_id
     * at retrieval time). Carried so citations can be anchored to an immutable
     * source version (ADR-005 §1).
     */
    versionId?: number;
    documentTitle?: string;
    /** `document.category` — the folder — so a consumer can gate on scope without a lookup. */
    category?: string;
    distance?: number;
    confidence?: number;
    source?: string;
    searchScope: SearchScope;
    retrievalMethod?: RetrievalMethod;
    embeddingIndexKey?: string;
    rerankScore?: number;
    timestamp?: string;
}

export interface SearchResult<T extends BaseSearchMetadata = BaseSearchMetadata> {
    retrievalMethod?: string;
    source?: string;
    pageNumber?: number;
    title?: string;
    documentId?: string | number;
    pageContent: string;
    metadata: T;
}

export interface DocumentSearchResult extends SearchResult {
    metadata: BaseSearchMetadata & {
        searchScope: "document";
    };
}

export interface CompanySearchResult extends SearchResult {
    metadata: BaseSearchMetadata & {
        searchScope: "company";
    };
}

export interface MultiDocSearchResult extends SearchResult {
    metadata: BaseSearchMetadata & {
        searchScope: "multi-document";
    };
}

export interface SearchFilters {
    documentClass?: string;
    dateRange?: { start?: Date; end?: Date };
    topicTags?: string[];
}

/**
 * Which documents the caller may read, expressed as folder names (the
 * `document.category` column) and document ids — never as a user, group, or
 * grant. The host resolves it once per request; every company-scoped leg
 * turns it into a predicate on the `document` table so out-of-scope chunks
 * never become candidates. Mirrors the host's `DocumentScope` exactly.
 *
 * - `everything`: no filter.
 * - `except`: allowed unless the category is denied or the id is denied,
 *   except ids in `allowedDocumentIds`, which are always allowed.
 * - `only`: allowed iff (category allowed AND id not denied) OR id in
 *   `allowedDocumentIds`.
 */
export type DocumentScope =
    | { readonly kind: "everything" }
    | {
          readonly kind: "except";
          readonly deniedCategories: readonly string[];
          readonly deniedDocumentIds: readonly number[];
          readonly allowedDocumentIds: readonly number[];
      }
    | {
          readonly kind: "only";
          readonly allowedCategories: readonly string[];
          readonly deniedDocumentIds: readonly number[];
          readonly allowedDocumentIds: readonly number[];
      };

export interface EnsembleSearchOptions {
    weights?: number[];
    topK?: number;
    minSimilarity?: number;
    filters?: SearchFilters;
    companyId?: number;
    embeddingIndexKey?: string;
}

export interface DocumentSearchOptions extends EnsembleSearchOptions {
    documentId: number;
}

export interface CompanySearchOptions extends EnsembleSearchOptions {
    companyId: number;
    /**
     * The caller's document scope. Applied to every company-scoped leg
     * (BM25, vector, graph, notes). Omitted means the whole company corpus —
     * only correct for callers that act for the workspace, not for a person.
     */
    scope?: DocumentScope;
}

export interface MultiDocSearchOptions extends EnsembleSearchOptions {
    documentIds: number[];
}

export interface ChunkRow {
    id: number;
    content: string;
    page: number;
    documentId: number;
    /** Document version the chunk belongs to (for citation anchoring). */
    versionId?: number;
    documentTitle?: string;
    /** `document.category` — the folder, so consumers can re-check scope without a lookup. */
    category?: string;
    embedding?: number[];
}

export interface ANNResult {
    id: number;
    content: string;
    page: number;
    documentId: number;
    distance: number;
    confidence: number;
}

export type ANNStrategy = "hnsw" | "ivf" | "hybrid" | "prefiltered" | "matryoshka";

export interface ANNConfig {
    strategy: ANNStrategy;
    probeCount?: number;
    efSearch?: number;
    maxCandidates?: number;
    prefilterThreshold?: number;
}

export interface DocumentCluster {
    documentId: number;
    centroid: number[];
    chunkIds: number[];
    avgDistance: number;
    lastUpdated: Date;
}

export type { EmbeddingsProvider } from "@launchstack/llm/embeddings";

export interface RAGSearchResult {
    content: string;
    page: number;
    documentId: string;
    documentTitle: string;
    relevanceScore: number;
}

export interface RAGSearchInput {
    query: string;
    documentIds: string[];
    topK?: number;
}
