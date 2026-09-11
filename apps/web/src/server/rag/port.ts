/**
 * Concrete RagPort implementation wrapping @launchstack/retrieval's ensemble
 * search. This is what apps/web hands to createEngine so features can run
 * retrieval queries without importing the retrieval stack directly.
 *
 * Imports go through ~/server/rag/ensemble (not the package) on purpose:
 * that module configures the ensemble — env flags, the app's notes leg —
 * at load, so a registered port implies a configured ensemble. The worst
 * retrieval failure is a silent one (ragCompanySearchSafe degrades a broken
 * port to empty context, not an error), so registration is logged loudly.
 *
 * The embedding model is created once per search call — the underlying
 * createOpenAIEmbeddings() is cheap to construct and the pipeline mutates
 * per-query options anyway.
 */

import type { RagPort, CompanySearchOptions, RagSearchResult } from "@launchstack/retrieval";
import { companyEnsembleSearch, createOpenAIEmbeddings } from "~/server/rag/ensemble";
import type {
    CompanySearchOptions as AppCompanySearchOptions,
    SearchResult as AppSearchResult,
} from "@launchstack/retrieval/search-types";

export function createAppRagPort(): RagPort {
    console.log("[rag/port] RagPort registered (ensemble configured via ~/server/rag/ensemble)");
    return {
        async companyEnsembleSearch(
            query: string,
            options: CompanySearchOptions
        ): Promise<RagSearchResult[]> {
            const embeddings = createOpenAIEmbeddings();
            const appOptions: AppCompanySearchOptions = {
                companyId: options.companyId,
                scope: options.scope,
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
            category: r.metadata.category,
            distance: r.metadata.distance,
            confidence: r.metadata.confidence,
            source: r.metadata.source,
            embeddingIndexKey: r.metadata.embeddingIndexKey,
            rerankScore: r.metadata.rerankScore,
            timestamp: r.metadata.timestamp,
        },
    };
}
