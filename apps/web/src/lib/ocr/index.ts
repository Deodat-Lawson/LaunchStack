/**
 * OCR-to-Vector Pipeline
 * Main exports for the document processing system
 */

// Types
export * from "@launchstack/core/ocr/types";

// Adapters
export { createAzureAdapter } from "@launchstack/core/ocr/adapters/azureAdapter";
export { createLandingAIAdapter } from "@launchstack/core/ocr/adapters/landingAdapter";

// Complexity analysis & Vision-based routing
export {
  determineDocumentRouting,
  type RoutingDecision,
} from "@launchstack/core/ocr/complexity";

// Chunking
export {
  chunkDocument,
  estimateTokens,
  getTotalChunkSize,
  prepareForEmbedding,
  mergeWithEmbeddings,
  type ChunkingConfig,
} from "@launchstack/core/ocr/chunker";

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

