/**
 * Shared types for the embeddings subsystem.
 */

/**
 * Minimal contract every embedding provider honors. Implementations may
 * additionally implement `embedDocuments` for batching; callers that depend
 * on batch semantics should fall back to looped embedQuery when it's
 * absent.
 */
export interface EmbeddingsProvider {
  embedQuery(query: string): Promise<number[]>;
  embedDocuments?(documents: string[]): Promise<number[][]>;
}
