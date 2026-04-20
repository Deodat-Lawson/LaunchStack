/**
 * OCR-to-Vector Pipeline
 * Main exports for the document processing system
 */

// Types
export * from "./types";

// Adapters
export { createAzureAdapter } from "./adapters/azureAdapter";
export { createLandingAIAdapter } from "./adapters/landingAdapter";

// Complexity analysis & Vision-based routing
export {
  determineDocumentRouting,
  type RoutingDecision,
} from "./complexity";

// Chunking
export {
  chunkDocument,
  estimateTokens,
  getTotalChunkSize,
  prepareForEmbedding,
  mergeWithEmbeddings,
  type ChunkingConfig,
} from "./chunker";

// Pipeline trigger
export {
  triggerDocumentProcessing,
  parseProvider,
  type TriggerOptions,
} from "./trigger";

// Processor (shared logic for sync/async processing)
export {
  processDocumentSync,
  routeDocument,
  normalizeDocument,
  chunkPages,
  vectorizeChunks,
  storeDocument,
  markJobFailed,
  processNativePDF,
  processWithAzure,
  processWithLandingAI,
  type RouterDecisionResult,
  type NormalizationResult,
} from "./processor";

