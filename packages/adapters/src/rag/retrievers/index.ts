/**
 * Engine retrievers.
 *
 * Deliberately NOT re-exported from ../index.ts (the published `rag` facade subpath):
 * bm25-retriever imports `@langchain/community`, which is an *optional* peer
 * dependency. A consumer who only wants the RagPort types must not be forced to
 * install it, so the retrievers live on their own `./rag/retrievers` subpath and
 * the peer is only resolved by importers that actually reach for them.
 */

export {
    VectorRetriever,
    createDocumentVectorRetriever,
    createCompanyVectorRetriever,
    createMultiDocVectorRetriever,
} from "./vector-retriever";

export {
    getDocumentChunks,
    getCompanyChunks,
    getMultiDocChunks,
    chunksToDocuments,
    createDocumentBM25Retriever,
    createCompanyBM25Retriever,
    createMultiDocBM25Retriever,
} from "./bm25-retriever";
