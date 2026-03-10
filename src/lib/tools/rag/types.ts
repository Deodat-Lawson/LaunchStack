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
  documentTitle?: string;
  distance?: number;
  confidence?: number;
  source?: string;
  searchScope: SearchScope;
  retrievalMethod?: RetrievalMethod;
  rerankScore?: number;
  timestamp?: string;
}

export interface SearchResult<T extends BaseSearchMetadata = BaseSearchMetadata> {
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

export interface EnsembleSearchOptions {
  weights?: [number, number];
  topK?: number;
  minSimilarity?: number;
  filters?: SearchFilters;
}

export interface DocumentSearchOptions extends EnsembleSearchOptions {
  documentId: number;
}

export interface CompanySearchOptions extends EnsembleSearchOptions {
  companyId: number;
}

export interface MultiDocSearchOptions extends EnsembleSearchOptions {
  documentIds: number[];
}

export interface ChunkRow {
  id: number;
  content: string;
  page: number;
  documentId: number;
  documentTitle?: string;
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

export type ANNStrategy = "hnsw" | "ivf" | "hybrid" | "prefiltered";

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

export interface EmbeddingsProvider {
  embedQuery(query: string): Promise<number[]>;
  embedDocuments?(documents: string[]): Promise<number[][]>;
}

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
