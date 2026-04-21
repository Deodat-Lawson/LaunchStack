/**
 * Concrete RagPort implementation that wraps the app's existing ensemble
 * search pipeline in ~/lib/tools/rag. This is what apps/web hands to
 * createEngine so features can run retrieval queries without importing
 * the RAG stack directly.
 *
 * The embedding model is created once per search call — the underlying
 * createOpenAIEmbeddings() is cheap to construct and the pipeline mutates
 * per-query options anyway.
 */

import type {
  RagPort,
  CompanySearchOptions,
  RagSearchResult,
} from "@launchstack/core/rag";
import {
  companyEnsembleSearch,
  createOpenAIEmbeddings,
  type CompanySearchOptions as AppCompanySearchOptions,
  type SearchResult as AppSearchResult,
} from "~/lib/tools/rag";

export function createAppRagPort(): RagPort {
  return {
    async companyEnsembleSearch(
      query: string,
      options: CompanySearchOptions,
    ): Promise<RagSearchResult[]> {
      const embeddings = createOpenAIEmbeddings();
      const appOptions: AppCompanySearchOptions = {
        companyId: options.companyId,
        topK: options.topK,
        weights: options.weights,
        minSimilarity: options.minSimilarity,
        filters: options.filters,
        embeddingIndexKey: options.embeddingIndexKey,
      };
      const results = await companyEnsembleSearch(query, appOptions, embeddings);
      return results.map(mapResult);
    },
  };
}

function mapResult(r: AppSearchResult): RagSearchResult {
  return {
    pageContent: r.pageContent,
    pageNumber: r.pageNumber,
    title: r.title,
    documentId: r.documentId,
    source: r.source,
    retrievalMethod: r.retrievalMethod,
    metadata: {
      chunkId: r.metadata.chunkId,
      page: r.metadata.page,
      documentId: r.metadata.documentId,
      documentTitle: r.metadata.documentTitle,
      distance: r.metadata.distance,
      confidence: r.metadata.confidence,
      source: r.metadata.source,
      embeddingIndexKey: r.metadata.embeddingIndexKey,
      rerankScore: r.metadata.rerankScore,
      timestamp: r.metadata.timestamp,
    },
  };
}
