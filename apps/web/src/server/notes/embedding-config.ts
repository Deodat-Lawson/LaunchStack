import { OpenAIEmbeddings } from "@langchain/openai";

import type { EmbeddingsProvider } from "@launchstack/core/embeddings";

/**
 * Shared embedding config for the notes pipeline. Both the write-side
 * (`embed-note.ts`) and read-side (semantic search, retriever) resolve the
 * provider key the same way, so a single misconfigured env var breaks neither
 * silently nor inconsistently.
 */

export const EMBEDDING_MODEL = "text-embedding-3-large";
export const EMBEDDING_DIM = 1536;
export const EMBEDDING_SHORT_DIM = 512;

export const NOTE_EMBEDDING_INDEX = Object.freeze({
  indexKey: "legacy-openai-1536",
  model: EMBEDDING_MODEL,
  dimension: EMBEDDING_DIM,
  shortDimension: EMBEDDING_SHORT_DIM,
  version: "v1",
});

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

export interface NoteEmbeddingIndex {
  readonly indexKey: string;
  readonly model: string;
  readonly dimension: number;
  readonly shortDimension: number;
  readonly version: string;
}

export interface NoteEmbeddingRuntime {
  embeddings: EmbeddingsProvider;
  index: NoteEmbeddingIndex;
}

/**
 * One explicit boundary for the fixed-width note vector table. Both note
 * writes and every note query must resolve through this function until a
 * schema migration and reindex can move notes to another embedding index.
 */
export function resolveNoteEmbeddingRuntime(): NoteEmbeddingRuntime | null {
  const { apiKey, baseURL } = resolveEmbeddingConfig();
  if (!apiKey || !baseURL) return null;

  return {
    embeddings: new OpenAIEmbeddings({
      openAIApiKey: apiKey,
      modelName: NOTE_EMBEDDING_INDEX.model,
      dimensions: NOTE_EMBEDDING_INDEX.dimension,
      configuration: { baseURL },
    }),
    index: NOTE_EMBEDDING_INDEX,
  };
}

