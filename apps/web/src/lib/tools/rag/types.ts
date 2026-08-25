/**
 * Moved to the engine: packages/core/src/rag/search-types.ts.
 *
 * Re-exported here so the existing `~/lib/tools/rag` consumers keep working
 * while the boundary inversion described in REPOSITORY.md finishes. Keeping one
 * definition matters more than the import path: the moved retrievers now return
 * core's types, and a second structurally-identical copy in the app would drift.
 */

export type {
    SearchScope,
    RetrievalMethod,
    BaseSearchMetadata,
    SearchResult,
    DocumentSearchResult,
    CompanySearchResult,
    MultiDocSearchResult,
    SearchFilters,
    EnsembleSearchOptions,
    DocumentSearchOptions,
    CompanySearchOptions,
    MultiDocSearchOptions,
    ChunkRow,
    ANNResult,
    ANNStrategy,
    ANNConfig,
    DocumentCluster,
    EmbeddingsProvider,
    RAGSearchResult,
    RAGSearchInput,
} from "@launchstack/search/search-types";
