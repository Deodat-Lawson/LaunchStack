/**
 * RAG port — the boundary core/features use to run retrieval-augmented
 * search queries. The full RAG pipeline (ensemble BM25 + vector + rerank
 * + optional graph retriever) lives in apps/web for now; this port is the
 * thin interface features need to invoke it without reaching back into
 * the app.
 *
 * Hosts implement the port and hand it in through CoreConfig.rag.port.
 * `creditsDebitSafe`-style ergonomics: if no port is registered, calls
 * resolve to an empty result set, so features work in non-RAG deploys
 * (e.g. pure ingestion) without special-casing.
 */

import type { DocumentScope } from "./search-types";

export type { DocumentScope };

export interface RagPort {
    /**
     * Run company-scoped ensemble search — BM25 + vector + optional rerank +
     * optional graph retriever, all fused via RRF. Returns top-K chunks
     * across the company's corpus, narrowed by `options.scope` when given.
     *
     * @deprecated There is no company-wide search: a search is always over a
     * set of document ids, and "everything" is the set of ids in the caller's
     * document scope. Resolve the readable ids and use the multi-document
     * search. Kept as a defence for callers that act for a workspace rather
     * than a person (pipelines).
     */
    companyEnsembleSearch(query: string, options: CompanySearchOptions): Promise<RagSearchResult[]>;
}

export interface CompanySearchOptions {
    companyId: number;
    /**
     * The caller's document scope (folder names and document ids). The host
     * resolves it per request and every company-scoped leg filters by it.
     * Omitted means the whole company corpus — for workspace-level callers only.
     */
    scope?: DocumentScope;
    topK?: number;
    /** Rank-fusion weights (length must match the number of retrievers). */
    weights?: number[];
    /** Minimum similarity score to keep (provider-dependent). */
    minSimilarity?: number;
    /** Optional per-document filters applied before fusion. */
    filters?: RagSearchFilters;
    /** Override the embedding index used for the vector retriever. */
    embeddingIndexKey?: string;
}

export interface RagSearchFilters {
    documentIds?: number[];
    documentClass?: string;
    dateRange?: { start?: Date; end?: Date };
    topicTags?: string[];
}

export interface RagSearchResult {
    pageContent: string;
    metadata: RagSearchMetadata;
    /** Duplicated shortcuts some renderers expect. */
    pageNumber?: number;
    title?: string;
    documentId?: string | number;
    source?: string;
    retrievalMethod?: string;
}

export interface RagSearchMetadata {
    chunkId?: number;
    page?: number;
    documentId?: number;
    documentTitle?: string;
    /** `document.category` — the folder — so a consumer can gate on scope without a lookup. */
    category?: string;
    distance?: number;
    confidence?: number;
    source?: string;
    embeddingIndexKey?: string;
    rerankScore?: number;
    timestamp?: string;
    [key: string]: unknown;
}
