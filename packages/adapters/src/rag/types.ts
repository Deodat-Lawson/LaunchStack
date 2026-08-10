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

export interface RagPort {
  /**
   * Run company-scoped ensemble search — BM25 + vector + optional rerank +
   * optional graph retriever, all fused via RRF. Returns top-K chunks
   * across the company's full corpus.
   */
  companyEnsembleSearch(
    query: string,
    options: CompanySearchOptions,
  ): Promise<RagSearchResult[]>;
}

export interface CompanySearchOptions {
  companyId: number;
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
  distance?: number;
  confidence?: number;
  source?: string;
  embeddingIndexKey?: string;
  rerankScore?: number;
  timestamp?: string;
  [key: string]: unknown;
}
