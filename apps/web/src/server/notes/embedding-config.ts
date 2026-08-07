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

/**
 * Endpoint and credential are resolved as a PAIR, most specific first.
 *
 * Neither half is ever taken from a different source than the other. The
 * `baseURL` also has no default on purpose: `@langchain/openai` falls back to
 * `api.openai.com` whenever it is undefined, which would send note text to a
 * vendor nothing in this configuration names. Callers must treat a missing
 * `baseURL` as "not configured" rather than passing it through — see
 * `assertEmbeddingConfigured`.
 */
export function resolveEmbeddingConfig(): EmbeddingProviderConfig {
  if (process.env.EMBEDDING_API_BASE_URL) {
    return {
      apiKey: process.env.EMBEDDING_API_KEY,
      baseURL: process.env.EMBEDDING_API_BASE_URL,
    };
  }

  if (process.env.AI_BASE_URL) {
    return {
      apiKey: process.env.AI_API_KEY ?? process.env.OPENAI_API_KEY,
      baseURL: process.env.AI_BASE_URL,
    };
  }

  return { apiKey: undefined, baseURL: undefined };
}

