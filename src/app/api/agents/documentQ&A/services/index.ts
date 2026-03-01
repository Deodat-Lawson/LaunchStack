/**
 * Shared services for document Q&A endpoints
 *
 * This module provides common functionality used by:
 * - AIQuery: Fast, efficient query search on one document (ensemble BM25 + Vector)
 * - AIQueryRLM: Hierarchical, cost-aware search for large documents (RLM-style)
 * - AIChat: Comprehensive search solution with conversation management
 *
 * All types are exported from ./types for better organization and tree-shaking
 */

// Functions
export { normalizeModelContent } from "./normalizeModelContent";
export { performWebSearch } from "./webSearch";
export { buildReferences, extractRecommendedPages, filterPagesByAICitation } from "./references";
export { performTavilySearch } from "./tavilySearch";
export { executeWebSearchAgent } from "./webSearchAgent";
export { SYSTEM_PROMPTS, getSystemPrompt, getWebSearchInstruction } from "./prompts";
export { getChatModel, getEmbeddings } from "./models";

// RLM Search (hierarchical, cost-aware retrieval for large documents)
export {
    performRLMSearch,
    getDocumentOverviewForPlanning,
    getDocumentOverviewsBatch,
    getDocumentStructureTree,
    getSectionsByPath,
    type RLMSearchOptions,
    type RLMSearchResult,
} from "./rlmSearch";

// Types - Centralized export from types.ts
export type {
    // AI Model Types
    AIModelType,
    // Response Style Types
    ResponseStyle,
    // Source Reference Types
    SourceReference,
    // Web Search Types
    WebSearchResult,
    WebSearchAgentInput,
    WebSearchAgentResult,
    // Prompt Types
    AIPersona,
    WebSearchInstructionParams,
    // Search Scope Types
    SearchScope,
    // Utility Types
    PromptStyle,
    PartialDeep,
    RequiredDeep,
} from "./types";

// Type guards
export {
    isAIModelType,
    isResponseStyle,
    isAIPersona,
    isSearchScope,
} from "./types";

// Additional types from specific modules
export type { PerformWebSearchResult } from "./webSearch";

