export type {
  SearchScope,
  RetrievalMethod,
  BaseSearchMetadata,
  SearchResult,
  DocumentSearchResult,
  CompanySearchResult,
  MultiDocSearchResult,
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
  RAGSearchInput,
  RAGSearchResult,
} from "./types";

export {
  VectorRetriever,
  createDocumentVectorRetriever,
  createCompanyVectorRetriever,
  createMultiDocVectorRetriever,
  getDocumentChunks,
  getCompanyChunks,
  getMultiDocChunks,
  chunksToDocuments,
  createDocumentBM25Retriever,
  createCompanyBM25Retriever,
  createMultiDocBM25Retriever,
  RLMRetriever,
  createRLMRetriever,
  getDocumentSummary,
  getStructureContent,
  GraphRetriever,
  createGraphRetriever,
} from "./retrievers";

export type {
  DocumentOverview,
  StructureNode,
  SectionWithCost,
  SectionPreview,
  WorkspaceEntry,
  TokenBudgetOptions,
  WorkspaceStoreOptions,
} from "./retrievers";

export {
  createOpenAIEmbeddings,
  createDocumentEnsembleRetriever,
  createCompanyEnsembleRetriever,
  createMultiDocEnsembleRetriever,
  documentEnsembleSearch,
  companyEnsembleSearch,
  multiDocEnsembleSearch,
} from "./search";

export {
  validateDocumentAccess,
  getUserCompanyId,
  formatResultsForPrompt,
  truncateText,
  cosineSimilarity,
  euclideanDistance,
} from "./utils";

export { ragSearchTool, executeRAGSearch } from "./agentic";
