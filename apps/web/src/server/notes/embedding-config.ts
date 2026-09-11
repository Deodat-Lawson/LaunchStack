/**
 * Shared embedding config for the notes pipeline. Both the write-side
 * (`embed-note.ts`) and read-side (semantic search, retriever) resolve the
 * provider key the same way, so a single misconfigured env var breaks neither
 * silently nor inconsistently.
 */

import { generateEmbeddings, type EmbeddingsProvider } from "@launchstack/llm/embeddings";

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


/**
 * The notes pipeline's one embeddings provider, generated through
 * @launchstack/llm's embedding service — no direct HTTP client here. Returns
 * null when no endpoint pair is configured so each caller keeps its own
 * skip/warn semantics (embedding a note is best-effort; searching without
 * an endpoint just returns nothing).
 */
export function createNotesEmbeddingsProvider(): EmbeddingsProvider | null {
  const { apiKey, baseURL } = resolveEmbeddingConfig();
  if (!apiKey || !baseURL) return null;

  const config = {
    apiKey,
    baseUrl: baseURL,
    model: EMBEDDING_MODEL,
    dimensions: EMBEDDING_DIM,
  };

  return {
    embedQuery: async (query: string) => {
      const { embeddings } = await generateEmbeddings([query], config);
      return embeddings[0] ?? [];
    },
    embedDocuments: async (documents: string[]) => {
      const { embeddings } = await generateEmbeddings(documents, config);
      return embeddings;
    },
  };
}
