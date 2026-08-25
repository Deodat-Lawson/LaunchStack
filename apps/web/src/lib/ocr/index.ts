/**
 * OCR-to-Vector Pipeline
 * Main exports for the document processing system
 */

// Types
export * from "@launchstack/conversion/ocr/types";

// Adapters
export { createAzureAdapter } from "@launchstack/conversion/ocr/adapters/azureAdapter";
export { createLandingAIAdapter } from "@launchstack/conversion/ocr/adapters/landingAdapter";

// Complexity analysis & Vision-based routing
export { determineDocumentRouting, type RoutingDecision } from "@launchstack/conversion/ocr/complexity";

// Chunking
export {
    chunkDocument,
    estimateTokens,
    getTotalChunkSize,
    prepareForEmbedding,
    mergeWithEmbeddings,
    type ChunkingConfig,
} from "@launchstack/conversion/ocr/chunker";

// Pipeline trigger
export {
    triggerDocumentProcessing,
    parseProvider,
    type TriggerOptions,
} from "@launchstack/conversion/ocr/trigger";

// Processor (shared logic for sync/async processing)
export {
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
} from "@launchstack/conversion/ocr/processor";
