/**
 * Shared embedding config for the notes pipeline. Both the write-side
 * (`embed-note.ts`) and read-side (semantic search, retriever) resolve the
 * provider key the same way, so a single misconfigured env var breaks neither
 * silently nor inconsistently.
 */

export const EMBEDDING_MODEL = "text-embedding-3-large";
export const EMBEDDING_DIM = 1536;
export const EMBEDDING_SHORT_DIM = 512;

export interface EmbeddingProviderConfig {
  apiKey: string | undefined;
  baseURL: string | undefined;
}

export function resolveEmbeddingConfig(): EmbeddingProviderConfig {
  return {
    apiKey:
      process.env.EMBEDDING_API_KEY ??
      process.env.AI_API_KEY ??
      process.env.OPENAI_API_KEY,
    baseURL: process.env.EMBEDDING_API_BASE_URL ?? process.env.AI_BASE_URL,
  };
}
