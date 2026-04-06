import { EnsembleRetriever } from "langchain/retrievers/ensemble";
import { OpenAIEmbeddings } from "@langchain/openai";
import { BM25Retriever } from "@langchain/community/retrievers/bm25";
import type { BaseRetriever } from "@langchain/core/retrievers";
import {
  createDocumentVectorRetriever,
  createCompanyVectorRetriever,
  createMultiDocVectorRetriever,
} from "../retrievers/vector-retriever";
import {
  createDocumentBM25Retriever,
  createCompanyBM25Retriever,
  createMultiDocBM25Retriever,
  getDocumentChunks,
  getCompanyChunks,
  getMultiDocChunks,
  chunksToDocuments,
} from "../retrievers/bm25-retriever";
import {
  createNeo4jGraphRetriever,
  shouldUseNeo4jRetriever,
} from "../retrievers/neo4j-graph-retriever";
import { createGraphRetriever } from "../retrievers/graph-retriever";
import type {
  SearchResult,
  DocumentSearchOptions,
  CompanySearchOptions,
  MultiDocSearchOptions,
  EmbeddingsProvider,
  SearchScope,
} from "../types";
import { getEmbeddingsForCompany } from "~/lib/ai/embedding-factory";
import type { CompanyEmbeddingConfig } from "~/lib/ai/embedding-config";

const DEFAULT_WEIGHTS_2: number[] = [0.4, 0.6];
const DEFAULT_WEIGHTS_3: number[] = [0.3, 0.5, 0.2];
const DEFAULT_TOP_K = 8;
const RERANK_CANDIDATE_MULTIPLIER = 4;
const SIDECAR_URL = process.env.SIDECAR_URL;

function isGraphRetrievalEnabled(): boolean {
  return (
    process.env.ENABLE_GRAPH_RETRIEVER === "true" ||
    process.env.ENABLE_GRAPH_RETRIEVER === "1"
  );
}

export function createOpenAIEmbeddings(
  config?: CompanyEmbeddingConfig | null,
): OpenAIEmbeddings {
  return getEmbeddingsForCompany(config);
}

export async function createDocumentEnsembleRetriever(
  options: DocumentSearchOptions,
  embeddings?: EmbeddingsProvider
): Promise<EnsembleRetriever> {
  const { documentId, companyId, topK = DEFAULT_TOP_K, filters } = options;
  const emb = embeddings ?? createOpenAIEmbeddings();
  const candidateK = topK * RERANK_CANDIDATE_MULTIPLIER;

  const bm25Retriever = await createDocumentBM25Retriever(documentId, candidateK);
  const vectorRetriever = createDocumentVectorRetriever(documentId, emb, candidateK, filters);

  const retrievers: BaseRetriever[] = [bm25Retriever, vectorRetriever];
  let weights = options.weights ?? DEFAULT_WEIGHTS_2;

  if (isGraphRetrievalEnabled() && companyId != null) {
    const graphRetriever = createGraphRetrieverForEnsemble(companyId, {
      documentIds: [documentId],
      topK: candidateK,
    });
    if (graphRetriever) {
      retrievers.push(graphRetriever);
      weights = options.weights ?? DEFAULT_WEIGHTS_3;
    }
  }

  return new EnsembleRetriever({ retrievers, weights });
}

export async function createCompanyEnsembleRetriever(
  options: CompanySearchOptions,
  embeddings?: EmbeddingsProvider
): Promise<EnsembleRetriever> {
  const { companyId, topK = 10, filters } = options;
  const emb = embeddings ?? createOpenAIEmbeddings();
  const candidateK = topK * RERANK_CANDIDATE_MULTIPLIER;

  const bm25Retriever = await createCompanyBM25Retriever(companyId, candidateK);
  const vectorRetriever = createCompanyVectorRetriever(companyId, emb, candidateK, filters);

  const retrievers: BaseRetriever[] = [bm25Retriever, vectorRetriever];
  let weights = options.weights ?? DEFAULT_WEIGHTS_2;

  if (isGraphRetrievalEnabled()) {
    const graphRetriever = createGraphRetrieverForEnsemble(companyId, {
      topK: candidateK,
    });
    if (graphRetriever) {
      retrievers.push(graphRetriever);
      weights = options.weights ?? DEFAULT_WEIGHTS_3;
    }
  }

  return new EnsembleRetriever({ retrievers, weights });
}

export async function createMultiDocEnsembleRetriever(
  options: MultiDocSearchOptions,
  embeddings?: EmbeddingsProvider
): Promise<EnsembleRetriever> {
  const { documentIds, companyId, topK = DEFAULT_TOP_K, filters } = options;
  const emb = embeddings ?? createOpenAIEmbeddings();
  const candidateK = topK * RERANK_CANDIDATE_MULTIPLIER;

  const bm25Retriever = await createMultiDocBM25Retriever(documentIds, candidateK);
  const vectorRetriever = createMultiDocVectorRetriever(documentIds, emb, candidateK, filters);

  const retrievers: BaseRetriever[] = [bm25Retriever, vectorRetriever];
  let weights = options.weights ?? DEFAULT_WEIGHTS_2;

  if (isGraphRetrievalEnabled() && companyId != null) {
    const graphRetriever = createGraphRetrieverForEnsemble(companyId, {
      documentIds,
      topK: candidateK,
    });
    if (graphRetriever) {
      retrievers.push(graphRetriever);
      weights = options.weights ?? DEFAULT_WEIGHTS_3;
    }
  }

  return new EnsembleRetriever({ retrievers, weights });
}

/**
 * Creates the appropriate graph retriever (Neo4j or PostgreSQL fallback).
 * Returns null if graph retrieval is not available.
 */
function createGraphRetrieverForEnsemble(
  companyId: number,
  options?: { documentIds?: number[]; topK?: number },
): BaseRetriever | null {
  if (shouldUseNeo4jRetriever()) {
    console.log(
      `[EnsembleSearch] Graph retriever: using NEO4J (companyId=${companyId}, docs=${options?.documentIds?.length ?? "all"})`,
    );
    return createNeo4jGraphRetriever(companyId, options);
  }

  console.log(
    `[EnsembleSearch] Graph retriever: using POSTGRESQL fallback (companyId=${companyId})`,
  );
  return createGraphRetriever(companyId, options);
}

export async function documentEnsembleSearch(
  query: string,
  options: DocumentSearchOptions,
  embeddings?: EmbeddingsProvider
): Promise<SearchResult[]> {
  const { documentId, topK = DEFAULT_TOP_K } = options;

  const graphEnabled = isGraphRetrievalEnabled() && options.companyId != null;
  console.log(
    `[EnsembleSearch] Searching document ${documentId} for: "${query.substring(0, 50)}..." ` +
    `(graph=${graphEnabled ? "ON" : "OFF"})`,
  );

  try {
    const retriever = await createDocumentEnsembleRetriever(options, embeddings);
    const results = await retriever.getRelevantDocuments(query);

    console.log(`[EnsembleSearch] Found ${results.length} candidates for document ${documentId} (topK=${topK}, graph=${graphEnabled ? "ON" : "OFF"})`);

    const mapped: SearchResult[] = results.map((doc) => ({
      pageContent: doc.pageContent,
      metadata: {
        ...doc.metadata,
        retrievalMethod: "ensemble_rrf",
        timestamp: new Date().toISOString(),
        searchScope: "document" as const,
      },
    }));

    const reranked = await rerankResults(query, mapped);
    return reranked.slice(0, topK);
  } catch (error) {
    console.error("[EnsembleSearch] Document search error:", error);
    return fallbackBM25Search(query, "document", { documentId }, topK);
  }
}

export async function companyEnsembleSearch(
  query: string,
  options: CompanySearchOptions,
  embeddings?: EmbeddingsProvider
): Promise<SearchResult[]> {
  const { companyId, topK = 10 } = options;

  const chunks = await getCompanyChunks(companyId);
  if (chunks.length === 0) {
    console.log(`[EnsembleSearch] No chunks for company ${companyId}, skipping search`);
    return [];
  }

  const graphEnabled = isGraphRetrievalEnabled();
  console.log(
    `[EnsembleSearch] Searching company ${companyId} for: "${query.substring(0, 50)}..." ` +
    `(graph=${graphEnabled ? "ON" : "OFF"})`,
  );

  try {
    const retriever = await createCompanyEnsembleRetriever(options, embeddings);
    const results = await retriever.getRelevantDocuments(query);

    console.log(`[EnsembleSearch] Found ${results.length} candidates for company ${companyId} (topK=${topK}, graph=${graphEnabled ? "ON" : "OFF"})`);

    const mapped: SearchResult[] = results.map((doc) => ({
      pageContent: doc.pageContent,
      metadata: {
        ...doc.metadata,
        retrievalMethod: "ensemble_rrf",
        timestamp: new Date().toISOString(),
        searchScope: "company" as const,
      },
    }));

    const reranked = await rerankResults(query, mapped);
    return reranked.slice(0, topK);
  } catch (error) {
    console.error("[EnsembleSearch] Company search error:", error);
    return fallbackBM25Search(query, "company", { companyId }, topK);
  }
}

export async function multiDocEnsembleSearch(
  query: string,
  options: MultiDocSearchOptions,
  embeddings?: EmbeddingsProvider
): Promise<SearchResult[]> {
  const { documentIds, topK = DEFAULT_TOP_K } = options;

  if (documentIds.length === 0) {
    console.log("[EnsembleSearch] No documents provided, returning empty");
    return [];
  }

  const graphEnabled = isGraphRetrievalEnabled() && options.companyId != null;
  console.log(
    `[EnsembleSearch] Searching ${documentIds.length} documents for: "${query.substring(0, 50)}..." ` +
    `(graph=${graphEnabled ? "ON" : "OFF"})`,
  );

  try {
    const retriever = await createMultiDocEnsembleRetriever(options, embeddings);
    const results = await retriever.getRelevantDocuments(query);

    console.log(
      `[EnsembleSearch] Found ${results.length} candidates from ${documentIds.length} documents (topK=${topK}, graph=${graphEnabled ? "ON" : "OFF"})`,
    );

    const mapped: SearchResult[] = results.map((doc) => ({
      pageContent: doc.pageContent,
      metadata: {
        ...doc.metadata,
        retrievalMethod: "ensemble_rrf",
        timestamp: new Date().toISOString(),
        searchScope: "multi-document" as const,
      },
    }));

    const reranked = await rerankResults(query, mapped);
    return reranked.slice(0, topK);
  } catch (error) {
    console.error("[EnsembleSearch] Multi-doc search error:", error);
    return fallbackBM25Search(query, "multi-document", { documentIds }, topK);
  }
}

// ============================================================================
// Reranking via Sidecar (graceful fallback: skip if no sidecar)
// ============================================================================

/**
 * Rerank search results using the sidecar's cross-encoder model.
 * If the sidecar is not configured, results pass through unchanged.
 */
async function rerankResults(
  query: string,
  results: SearchResult[],
): Promise<SearchResult[]> {
  if (!SIDECAR_URL || results.length === 0) {
    console.log(
      `[Rerank] Skipping: sidecar=${SIDECAR_URL ? "configured" : "not configured"}, results=${results.length}`,
    );
    return results;
  }

  const rerankStart = Date.now();
  console.log(
    `[Rerank] Calling sidecar at ${SIDECAR_URL}/rerank with ${results.length} results, ` +
    `query="${query.substring(0, 60)}..."`,
  );

  try {
    const resp = await fetch(`${SIDECAR_URL}/rerank`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        documents: results.map((r) => r.pageContent),
      }),
    });

    if (!resp.ok) {
      console.warn(
        `[Rerank] Sidecar returned ${resp.status}, skipping rerank (${Date.now() - rerankStart}ms)`,
      );
      return results;
    }

    const data = (await resp.json()) as { scores: number[] };

    const reranked: SearchResult[] = results
      .map((result, idx) => ({
        result,
        score: data.scores[idx] ?? 0,
      }))
      .sort((a, b) => b.score - a.score)
      .map(({ result, score }) => ({
        ...result,
        metadata: {
          ...result.metadata,
          rerankScore: score,
          retrievalMethod: "ensemble_rrf_reranked" as const,
        },
      }));

    const scores = data.scores.sort((a, b) => b - a);
    const elapsed = Date.now() - rerankStart;
    console.log(
      `[Rerank] Reranked ${reranked.length} results (${elapsed}ms): ` +
      `top=${scores[0]?.toFixed(3) ?? "N/A"}, median=${scores[Math.floor(scores.length / 2)]?.toFixed(3) ?? "N/A"}, ` +
      `bottom=${scores[scores.length - 1]?.toFixed(3) ?? "N/A"}`,
    );

    return reranked;
  } catch (error) {
    const elapsed = Date.now() - rerankStart;
    console.warn(
      `[Rerank] Sidecar reranking failed (${elapsed}ms), returning original order:`,
      error instanceof Error ? error.message : error,
    );
    return results;
  }
}

async function fallbackBM25Search(
  query: string,
  scope: SearchScope,
  ids: { documentId?: number; companyId?: number; documentIds?: number[] },
  topK: number
): Promise<SearchResult[]> {
  console.warn(`[EnsembleSearch] Falling back to BM25-only search for ${scope}`);

  try {
    let chunks;
    if (scope === "document" && ids.documentId !== undefined) {
      chunks = await getDocumentChunks(ids.documentId);
    } else if (scope === "company" && ids.companyId !== undefined) {
      chunks = await getCompanyChunks(ids.companyId);
    } else if (scope === "multi-document" && ids.documentIds?.length) {
      chunks = await getMultiDocChunks(ids.documentIds);
    } else {
      return [];
    }

    if (chunks.length === 0) {
      return [];
    }

    const docs = chunksToDocuments(chunks, scope);
    const retriever = BM25Retriever.fromDocuments(docs, { k: topK });
    const results = await retriever.getRelevantDocuments(query);

    return results.map((doc) => ({
      pageContent: doc.pageContent,
      metadata: {
        ...doc.metadata,
        retrievalMethod: "bm25_fallback",
        timestamp: new Date().toISOString(),
        searchScope: scope,
      },
    }));
  } catch (fallbackError) {
    console.error("[EnsembleSearch] Fallback search error:", fallbackError);
    return [];
  }
}
