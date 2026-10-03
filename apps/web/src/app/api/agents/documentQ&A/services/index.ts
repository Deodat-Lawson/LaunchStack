/**
 * Shared services for document Q&A endpoints
 *
 * This module provides common functionality used by AIChat, the document
 * Q&A endpoint: answers with conversation management, retrieval and web search.
 *
 * All types are exported from ./types for better organization and tree-shaking
 */

// Functions
export { normalizeModelContent } from "./normalizeModelContent";
export { buildReferences, extractRecommendedPages } from "./references";
export { performExaSearch } from "./exaSearch";
export { SYSTEM_PROMPTS, getSystemPrompt } from "./prompts";
export {
    resolveConfiguredChatModel,
    resolveConfiguredChatRoute,
    selectChatRoute,
    getEmbeddings,
} from "./models";
export { describeChatError } from "@launchstack/llm";
export { ChatRoutes, isChatRoute } from "./types";

// Types - Centralized export from types.ts
export type {
    // Chat routing types
    ChatRoute,
    ChatCapability,
    // Response Style Types
    ResponseStyle,
    // Source Reference Types
    SourceReference,
    // Web Search Types
    WebSearchResult,
    // Prompt Types
    AIPersona,
    // Search Scope Types
    SearchScope,
    // Utility Types
    PromptStyle,
    PartialDeep,
    RequiredDeep,
} from "./types";

// Type guards
export { isResponseStyle, isAIPersona, isSearchScope } from "./types";
