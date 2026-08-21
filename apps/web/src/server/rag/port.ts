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

import type { RagPort, CompanySearchOptions, RagSearchResult } from "@launchstack/core/rag";
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
            options: CompanySearchOptions
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
    const metadata = r.metadata as AppSearchResult["metadata"] & {
        noteId?: number;
        callId?: string;
        revision?: number;
    };
    const source = r.source ?? metadata.source;
    return {
        pageContent: r.pageContent,
        pageNumber: r.pageNumber,
        title: r.title,
        documentId: r.documentId,
        source,
        retrievalMethod: r.retrievalMethod,
        metadata: {
            chunkId: metadata.chunkId,
            page: metadata.page,
            documentId: metadata.documentId,
            documentTitle: metadata.documentTitle,
            distance: metadata.distance,
            confidence: metadata.confidence,
            source,
            embeddingIndexKey: metadata.embeddingIndexKey,
            rerankScore: metadata.rerankScore,
            timestamp: metadata.timestamp,
            ...(metadata.noteId === undefined ? {} : { noteId: metadata.noteId }),
            ...(metadata.callId === undefined ? {} : { callId: metadata.callId }),
            ...(metadata.revision === undefined ? {} : { revision: metadata.revision }),
        },
    };
}
