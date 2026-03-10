/**
 * Type definitions for Document Q&A services
 * 
 * This file centralizes all type definitions used across the document Q&A services.
 * Following TypeScript best practices:
 * - Use `type` for unions, intersections, and aliases
 * - Use `interface` for object shapes that may be extended
 * - Export types explicitly for better tree-shaking
 * - Group related types together
 * - Document types with JSDoc comments
 */

// ============================================================================
// AI Model Types
// ============================================================================

/**
 * Supported AI model types for chat generation
 */
export type AIModelType =
  | "gpt-4o"
  | "gpt-5.2"
  | "gpt-5.1"
  | "gpt-5-nano"
  | "gpt-5-mini"
  | "claude-sonnet-4"
  | "claude-opus-4.5"
  | "gemini-2.5-flash"
  | "gemini-3-flash"
  | "gemini-3-pro";

/**
 * Union type of all supported AI model names
 * Useful for type checking and validation
 */
export const AIModelTypes = ["gpt-4o", "gpt-5.2", "gpt-5.1", "gpt-5-nano", "gpt-5-mini", "claude-sonnet-4", "claude-opus-4.5", "gemini-2.5-flash", "gemini-3-flash", "gemini-3-pro"] as const;

/**
 * Type guard to check if a string is a valid AI model type
 */
export function isAIModelType(value: string): value is AIModelType {
    return AIModelTypes.includes(value as AIModelType);
}

// ============================================================================
// Response Style Types
// ============================================================================

/**
 * Available response styles for AI answers
 */
export type ResponseStyle = "concise" | "detailed" | "academic" | "bullet-points";

/**
 * Const assertion for response styles - enables better type inference
 */
export const ResponseStyles = ["concise", "detailed", "academic", "bullet-points"] as const;

/**
 * Type guard for response style validation
 */
export function isResponseStyle(value: string): value is ResponseStyle {
    return ResponseStyles.includes(value as ResponseStyle);
}

// ============================================================================
// Web Search Types
// ============================================================================

/**
 * Web search result from Tavily API or web search agent
 * 
 * @property title - Title of the search result
 * @property url - URL of the source
 * @property snippet - Content snippet from the source
 * @property relevanceScore - Optional relevance score (1-10) from agent synthesis
 */
export interface WebSearchResult {
    /** Title of the search result */
    title: string;
    /** URL of the source */
    url: string;
    /** Content snippet from the source */
    snippet: string;
    /** Optional relevance score (1-10) from agent synthesis */
    relevanceScore?: number;
}

/**
 * Input parameters for web search agent
 * 
 * @property userQuestion - The user's question to search for
 * @property documentContext - Optional document context to refine search
 * @property maxResults - Maximum number of results to return (default: 5)
 * @property searchDepth - Search depth level (default: "basic")
 */
export interface WebSearchAgentInput {
    /** The user's question to search for */
    userQuestion: string;
    /** Optional document context to refine search */
    documentContext?: string;
    /** Maximum number of results to return (default: 5) */
    maxResults?: number;
    /** Search depth level */
    searchDepth?: "basic" | "advanced";
}

/**
 * Result from web search agent execution
 * 
 * @property results - Array of web search results
 * @property refinedQuery - The refined search query used
 * @property reasoning - Optional reasoning for the search refinement
 */
export interface WebSearchAgentResult {
    /** Array of web search results */
    results: WebSearchResult[];
    /** The refined search query used */
    refinedQuery: string;
    /** Optional reasoning for the search refinement */
    reasoning?: string;
}


// ============================================================================
// Prompt Types
// ============================================================================

/**
 * AI persona types for specialized responses
 */
export type AIPersona = "general" | "learning-coach" | "financial-expert" | "legal-expert" | "math-reasoning";

/**
 * Const assertion for AI persona types
 */
export const AIPersonas = ["general", "learning-coach", "financial-expert", "legal-expert", "math-reasoning"] as const;

/**
 * Type guard for AI persona validation
 */
export function isAIPersona(value: string): value is AIPersona {
    return AIPersonas.includes(value as AIPersona);
}

/**
 * Parameters for generating web search instruction prompt
 */
export interface WebSearchInstructionParams {
    /** Whether web search is enabled */
    enableWebSearch: boolean;
    /** Array of web search results */
    webSearchResults: WebSearchResult[];
    /** Refined search query used */
    refinedQuery?: string;
    /** Reasoning for search refinement */
    reasoning?: string;
}

// ============================================================================
// Source Reference Types
// ============================================================================

/**
 * A reference to a source excerpt (e.g. from RAG search) for citations and highlighting
 */
export interface SourceReference {
  /** Page number (1-based) if applicable */
  page?: number;
  /** Snippet of text from the source */
  snippet: string;
  /** Matched keyword/phrase for highlighting */
  matchText?: string;
  /** Start index of match in snippet */
  matchStart?: number;
  /** End index of match in snippet */
  matchEnd?: number;
  /** Confidence score 0–1 */
  confidence?: number;
  /** Document ID if from a stored document */
  documentId?: number;
  /** Document title for display */
  documentTitle?: string;
  /** Chunk ID within document */
  chunkId?: number;
  /** Source identifier (e.g. URL) */
  source?: string;
}

// ============================================================================
// Search Scope Types
// ============================================================================

/**
 * Search scope for document queries
 */
export type SearchScope = "document" | "company";

/**
 * Const assertion for search scope types
 */
export const SearchScopes = ["document", "company"] as const;

/**
 * Type guard for search scope validation
 */
export function isSearchScope(value: string): value is SearchScope {
    return SearchScopes.includes(value as SearchScope);
}

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Extract keys from SYSTEM_PROMPTS object type
 * This ensures type safety when referencing prompt styles
 */
import type { SYSTEM_PROMPTS } from "./prompts";

export type PromptStyle = keyof typeof SYSTEM_PROMPTS;

/**
 * Helper type for optional properties
 * Makes all properties in T optional
 */
export type PartialDeep<T> = {
    [P in keyof T]?: T[P] extends object ? PartialDeep<T[P]> : T[P];
};

/**
 * Helper type for required properties
 * Makes all properties in T required
 */
export type RequiredDeep<T> = {
    [P in keyof T]-?: T[P] extends object ? RequiredDeep<T[P]> : T[P];
};

