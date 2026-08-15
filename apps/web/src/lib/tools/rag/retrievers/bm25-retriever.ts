/**
 * Moved to the engine: packages/core/src/rag/retrievers/bm25-retriever.ts.
 *
 * Kept as a re-export so the existing `~/lib/tools/rag` consumers keep working
 * while the boundary inversion described in REPOSITORY.md finishes. New app code
 * should import from `@launchstack/core/rag/retrievers` directly.
 */

export {
    getDocumentChunks,
    getCompanyChunks,
    getMultiDocChunks,
    chunksToDocuments,
    createDocumentBM25Retriever,
    createCompanyBM25Retriever,
    createMultiDocBM25Retriever,
} from "@launchstack/core/rag/retrievers";
