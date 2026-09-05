import { EnsembleRetriever } from "langchain/retrievers/ensemble";
import { BM25Retriever } from "@langchain/community/retrievers/bm25";
import type { BaseRetriever } from "@langchain/core/retrievers";
import { createEmbeddingModel } from "@launchstack/llm/embeddings";
import { resolveEmbeddingIndex } from "@launchstack/llm/embeddings";
import { getRerankProvider, isRerankConfigured } from "../reranking";
import {
    createDocumentVectorRetriever,
    createCompanyVectorRetriever,
    createMultiDocVectorRetriever,
} from "../vector";
import {
    createDocumentBM25Retriever,
    createCompanyBM25Retriever,
    createMultiDocBM25Retriever,
    getDocumentChunks,
    getCompanyChunks,
    getMultiDocChunks,
    chunksToDocuments,
} from "../bm25";
import { createNeo4jGraphRetriever, shouldUseNeo4jRetriever, createGraphRetriever } from "../graph";
import { getEnsembleConfig } from "./config";
import type {
    SearchResult,
    DocumentSearchOptions,
    CompanySearchOptions,
    DocumentScope,
    MultiDocSearchOptions,
    EmbeddingsProvider,
    SearchScope,
} from "../../search-types";

const DEFAULT_WEIGHTS_2: number[] = [0.4, 0.6];
const DEFAULT_WEIGHTS_3: number[] = [0.3, 0.5, 0.2];
const DEFAULT_TOP_K = 8;
const RERANK_CANDIDATE_MULTIPLIER = 4;
// Notes are often short and thin; boosting them above ~0.2 lets a handful of
// sticky notes outweigh large document corpora under RRF. Keep the boost
// modest unless a tenant explicitly opts into note-heavy retrieval.
const NOTES_DEFAULT_WEIGHT = 0.15;
// Cap note candidates so we don't flood the ensemble when a doc has dozens
// of notes. The reranker downstream trims to the final topK anyway.
const NOTES_MAX_CANDIDATES = 8;
// Company facts are few, short and curated: a fact that matches should land
// beside the chunks that say the same thing, not above the whole corpus.
// Same share the graph leg gets, for the same reason.
const FACTS_DEFAULT_WEIGHT = 0.2;
// The projection is one JSON row; a question rarely touches more than a few
// of its facts, and anything past that is the lexical scorer guessing.
const FACTS_MAX_CANDIDATES = 6;

function isGraphRetrievalEnabled(): boolean {
    return getEnsembleConfig().graphRetrieval;
}

/**
 * Per-leg visibility: a silently dead leg (graph peer down, empty notes) is
 * invisible in the total count, so log how many candidates each source
 * contributed. `source` is stamped by each retriever's Document metadata.
 */
function logLegBreakdown(scopeLabel: string, results: Array<{ metadata: object }>): void {
    const bySource = new Map<string, number>();
    for (const r of results) {
        const raw = (r.metadata as { source?: unknown }).source;
        const source = typeof raw === "string" ? raw : "chunk";
        bySource.set(source, (bySource.get(source) ?? 0) + 1);
    }
    const parts = [...bySource.entries()].map(([source, n]) => `${source}=${n}`);
    console.log(`[EnsembleSearch] Leg breakdown (${scopeLabel}): ${parts.join(", ") || "none"}`);
}

export function createOpenAIEmbeddings(): EmbeddingsProvider {
    return createEmbeddingModel(resolveEmbeddingIndex());
}

export function createEmbeddingsForIndex(indexKey?: string): EmbeddingsProvider {
    return createEmbeddingModel(resolveEmbeddingIndex(indexKey));
}

export async function createDocumentEnsembleRetriever(
    options: DocumentSearchOptions,
    embeddings?: EmbeddingsProvider
): Promise<EnsembleRetriever> {
    const { documentId, companyId, topK = DEFAULT_TOP_K, filters } = options;
    const emb = embeddings ?? createEmbeddingsForIndex(options.embeddingIndexKey);
    const candidateK = topK * RERANK_CANDIDATE_MULTIPLIER;

    const bm25Retriever = await createDocumentBM25Retriever(documentId, candidateK);
    const vectorRetriever = createDocumentVectorRetriever(
        documentId,
        emb,
        resolveEmbeddingIndex(options.embeddingIndexKey),
        candidateK,
        filters
    );

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

    const notesLegs = getEnsembleConfig().notesLegs;
    if (notesLegs) {
        const notesRetriever = notesLegs.createDocumentLeg(
            documentId,
            emb,
            Math.min(candidateK, NOTES_MAX_CANDIDATES)
        );
        retrievers.push(notesRetriever);
        weights = [...weights, NOTES_DEFAULT_WEIGHT];
    }

    const factsLegs = getEnsembleConfig().factsLegs;
    if (factsLegs && companyId != null) {
        retrievers.push(
            factsLegs.createDocumentLeg(
                documentId,
                companyId,
                Math.min(candidateK, FACTS_MAX_CANDIDATES)
            )
        );
        weights = [...weights, FACTS_DEFAULT_WEIGHT];
    }

    return new EnsembleRetriever({ retrievers, weights });
}

export async function createCompanyEnsembleRetriever(
    options: CompanySearchOptions,
    embeddings?: EmbeddingsProvider
): Promise<EnsembleRetriever> {
    // The scope reaches every leg: a chunk the caller may not read is never
    // a candidate, whichever retriever would have surfaced it.
    const { companyId, topK = 10, filters, scope } = options;
    const emb = embeddings ?? createEmbeddingsForIndex(options.embeddingIndexKey);
    const candidateK = topK * RERANK_CANDIDATE_MULTIPLIER;

    const bm25Retriever = await createCompanyBM25Retriever(companyId, candidateK, scope);
    const vectorRetriever = createCompanyVectorRetriever(
        companyId,
        emb,
        resolveEmbeddingIndex(options.embeddingIndexKey),
        candidateK,
        filters,
        scope
    );

    const retrievers: BaseRetriever[] = [bm25Retriever, vectorRetriever];
    let weights = options.weights ?? DEFAULT_WEIGHTS_2;

    if (isGraphRetrievalEnabled()) {
        const graphRetriever = createGraphRetrieverForEnsemble(companyId, {
            topK: candidateK,
            scope,
        });
        if (graphRetriever) {
            retrievers.push(graphRetriever);
            weights = options.weights ?? DEFAULT_WEIGHTS_3;
        }
    }

    const notesLegs = getEnsembleConfig().notesLegs;
    if (notesLegs) {
        const notesRetriever = notesLegs.createCompanyLeg(
            companyId,
            emb,
            Math.min(candidateK, NOTES_MAX_CANDIDATES),
            scope
        );
        retrievers.push(notesRetriever);
        weights = [...weights, NOTES_DEFAULT_WEIGHT];
    }

    const factsLegs = getEnsembleConfig().factsLegs;
    if (factsLegs) {
        retrievers.push(
            factsLegs.createCompanyLeg(companyId, Math.min(candidateK, FACTS_MAX_CANDIDATES), scope)
        );
        weights = [...weights, FACTS_DEFAULT_WEIGHT];
    }

    return new EnsembleRetriever({ retrievers, weights });
}

export async function createMultiDocEnsembleRetriever(
    options: MultiDocSearchOptions,
    embeddings?: EmbeddingsProvider
): Promise<EnsembleRetriever> {
    const { documentIds, companyId, topK = DEFAULT_TOP_K, filters } = options;
    const emb = embeddings ?? createEmbeddingsForIndex(options.embeddingIndexKey);
    const candidateK = topK * RERANK_CANDIDATE_MULTIPLIER;

    const bm25Retriever = await createMultiDocBM25Retriever(documentIds, candidateK);
    const vectorRetriever = createMultiDocVectorRetriever(
        documentIds,
        emb,
        resolveEmbeddingIndex(options.embeddingIndexKey),
        candidateK,
        filters
    );

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

    const notesLegs = getEnsembleConfig().notesLegs;
    if (notesLegs) {
        const notesRetriever = notesLegs.createMultiDocLeg(
            documentIds,
            emb,
            Math.min(candidateK, NOTES_MAX_CANDIDATES)
        );
        retrievers.push(notesRetriever);
        weights = [...weights, NOTES_DEFAULT_WEIGHT];
    }

    const factsLegs = getEnsembleConfig().factsLegs;
    if (factsLegs && companyId != null) {
        retrievers.push(
            factsLegs.createMultiDocLeg(
                documentIds,
                companyId,
                Math.min(candidateK, FACTS_MAX_CANDIDATES)
            )
        );
        weights = [...weights, FACTS_DEFAULT_WEIGHT];
    }

    return new EnsembleRetriever({ retrievers, weights });
}

/**
 * Creates the appropriate graph retriever (Neo4j or PostgreSQL fallback).
 * Returns null if graph retrieval is not available.
 */
function createGraphRetrieverForEnsemble(
    companyId: number,
    options?: { documentIds?: number[]; topK?: number; scope?: DocumentScope }
): BaseRetriever | null {
    if (shouldUseNeo4jRetriever()) {
        console.log(
            `[EnsembleSearch] Graph retriever: using NEO4J (companyId=${companyId}, docs=${options?.documentIds?.length ?? "all"})`
        );
        return createNeo4jGraphRetriever(companyId, options);
    }

    console.log(
        `[EnsembleSearch] Graph retriever: using POSTGRESQL fallback (companyId=${companyId})`
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
            `(graph=${graphEnabled ? "ON" : "OFF"})`
    );

    try {
        const retriever = await createDocumentEnsembleRetriever(options, embeddings);
        const results = await retriever.getRelevantDocuments(query);

        console.log(
            `[EnsembleSearch] Found ${results.length} candidates for document ${documentId} (topK=${topK}, graph=${graphEnabled ? "ON" : "OFF"})`
        );

        const mapped: SearchResult[] = results.map(doc => ({
            pageContent: doc.pageContent,
            metadata: {
                ...doc.metadata,
                retrievalMethod: "ensemble_rrf",
                timestamp: new Date().toISOString(),
                searchScope: "document" as const,
            },
        }));

        logLegBreakdown("document", results);
        const reranked = await rerankResults(query, mapped);
        return reranked.slice(0, topK);
    } catch (error) {
        console.error("[EnsembleSearch] Document search error:", error);
        return fallbackBM25Search(query, "document", { documentId }, topK);
    }
}

/**
 * @deprecated There is no company-wide search: a search is always over a set
 * of document ids, and "everything" is the set of ids in the caller's
 * document scope. Resolve the readable ids and use `multiDocEnsembleSearch`.
 * Kept, with `options.scope` applied to every leg, as a defence for callers
 * that act for a workspace rather than a person (pipelines).
 */
export async function companyEnsembleSearch(
    query: string,
    options: CompanySearchOptions,
    embeddings?: EmbeddingsProvider
): Promise<SearchResult[]> {
    const { companyId, topK = 10, scope } = options;

    const chunks = await getCompanyChunks(companyId, scope);
    if (chunks.length === 0) {
        console.log(`[EnsembleSearch] No chunks for company ${companyId}, skipping search`);
        return [];
    }

    const graphEnabled = isGraphRetrievalEnabled();
    console.log(
        `[EnsembleSearch] Searching company ${companyId} for: "${query.substring(0, 50)}..." ` +
            `(graph=${graphEnabled ? "ON" : "OFF"})`
    );

    try {
        const retriever = await createCompanyEnsembleRetriever(options, embeddings);
        const results = await retriever.getRelevantDocuments(query);

        console.log(
            `[EnsembleSearch] Found ${results.length} candidates for company ${companyId} (topK=${topK}, graph=${graphEnabled ? "ON" : "OFF"})`
        );

        const mapped: SearchResult[] = results.map(doc => ({
            pageContent: doc.pageContent,
            metadata: {
                ...doc.metadata,
                retrievalMethod: "ensemble_rrf",
                timestamp: new Date().toISOString(),
                searchScope: "company" as const,
            },
        }));

        logLegBreakdown("company", results);
        const reranked = await rerankResults(query, mapped);
        return reranked.slice(0, topK);
    } catch (error) {
        console.error("[EnsembleSearch] Company search error:", error);
        return fallbackBM25Search(query, "company", { companyId, scope }, topK);
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
            `(graph=${graphEnabled ? "ON" : "OFF"})`
    );

    try {
        const retriever = await createMultiDocEnsembleRetriever(options, embeddings);
        const results = await retriever.getRelevantDocuments(query);

        console.log(
            `[EnsembleSearch] Found ${results.length} candidates from ${documentIds.length} documents (topK=${topK}, graph=${graphEnabled ? "ON" : "OFF"})`
        );

        const mapped: SearchResult[] = results.map(doc => ({
            pageContent: doc.pageContent,
            metadata: {
                ...doc.metadata,
                retrievalMethod: "ensemble_rrf",
                timestamp: new Date().toISOString(),
                searchScope: "multi-document" as const,
            },
        }));

        logLegBreakdown("multi-document", results);
        const reranked = await rerankResults(query, mapped);
        return reranked.slice(0, topK);
    } catch (error) {
        console.error("[EnsembleSearch] Multi-doc search error:", error);
        return fallbackBM25Search(query, "multi-document", { documentIds }, topK);
    }
}

// ============================================================================
// Reranking via core's configured rerank provider (graceful pass-through)
// ============================================================================

/**
 * Rerank search results through @launchstack/core's configured rerank
 * provider — the dedicated /v1/rerank client when RERANK_API_BASE_URL names
 * one, otherwise the chat-model scorer on the deployment's endpoint. (The raw
 * ${SIDECAR_URL}/rerank fetch that used to live here targeted a route no
 * service ever implemented — removed by ADR-004 §5.)
 *
 * Unconfigured or failing reranking is not fatal: the candidates pass through
 * in their existing RRF order.
 */
async function rerankResults(query: string, results: SearchResult[]): Promise<SearchResult[]> {
    if (results.length === 0) {
        return results;
    }

    // Reranking is opt-in (RERANK_API_BASE_URL). Unconfigured deployments keep
    // the RRF order without spending a chat-model call per search — the
    // pre-refactor production behavior (the sidecar rerank never existed).
    if (!isRerankConfigured()) {
        return results;
    }

    const rerankStart = Date.now();

    try {
        const provider = await getRerankProvider();
        console.log(
            `[Rerank] Scoring ${results.length} results via ${provider.name}, ` +
                `query="${query.substring(0, 60)}..."`
        );

        const { data } = await provider.rerank(
            query,
            results.map(r => r.pageContent)
        );

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

        const scores = [...data.scores].sort((a, b) => b - a);
        const elapsed = Date.now() - rerankStart;
        console.log(
            `[Rerank] Reranked ${reranked.length} results (${elapsed}ms): ` +
                `top=${scores[0]?.toFixed(3) ?? "N/A"}, median=${scores[Math.floor(scores.length / 2)]?.toFixed(3) ?? "N/A"}, ` +
                `bottom=${scores[scores.length - 1]?.toFixed(3) ?? "N/A"}`
        );

        return reranked;
    } catch (error) {
        const elapsed = Date.now() - rerankStart;
        console.warn(
            `[Rerank] Reranking failed or is unconfigured (${elapsed}ms), returning original order:`,
            error instanceof Error ? error.message : error
        );
        return results;
    }
}

async function fallbackBM25Search(
    query: string,
    scope: SearchScope,
    ids: {
        documentId?: number;
        companyId?: number;
        documentIds?: number[];
        /** The caller's document scope — the fallback must not widen the corpus. */
        scope?: DocumentScope;
    },
    topK: number
): Promise<SearchResult[]> {
    console.warn(`[EnsembleSearch] Falling back to BM25-only search for ${scope}`);

    try {
        let chunks;
        if (scope === "document" && ids.documentId !== undefined) {
            chunks = await getDocumentChunks(ids.documentId);
        } else if (scope === "company" && ids.companyId !== undefined) {
            chunks = await getCompanyChunks(ids.companyId, ids.scope);
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

        return results.map(doc => ({
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
