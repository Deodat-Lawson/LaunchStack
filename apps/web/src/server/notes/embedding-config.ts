import { generateEmbeddings, type EmbeddingsProvider } from "@launchstack/llm/embeddings";

/**
 * Shared embedding config for the notes pipeline. Both the write-side
 * (`embed-note.ts`) and read-side (semantic search, retriever) resolve the
 * provider key the same way, so a single misconfigured env var breaks neither
 * silently nor inconsistently.
 */

/** Model when the endpoint pair names none (AI_BASE_URL, or no EMBEDDING_MODEL). */
export const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-large";
/**
 * Notes keep their own 1536-wide column whatever EMBEDDING_INDEX documents use,
 * so any model that can emit 1536 dimensions fits — text-embedding-3-large, or
 * gemini-embedding-001 via Matryoshka truncation.
 */
export const EMBEDDING_DIM = 1536;
export const EMBEDDING_SHORT_DIM = 512;

export const NOTE_EMBEDDING_INDEX = Object.freeze({
    indexKey: "legacy-openai-1536",
    model: DEFAULT_EMBEDDING_MODEL,
    dimension: EMBEDDING_DIM,
    shortDimension: EMBEDDING_SHORT_DIM,
    version: "v1",
});

export interface EmbeddingProviderConfig {
    apiKey: string | undefined;
    baseURL: string | undefined;
    /** The model the endpoint serves; the OpenAI default 404s on Gemini. */
    model: string;
}

/**
 * Endpoint and credential are resolved as a PAIR, most specific first.
 *
 * Neither half is ever taken from a different source than the other. The
 * `baseURL` also has no default on purpose: the embedding service rejects
 * missing endpoints rather than sending note text to a vendor nothing in this
 * configuration names. Callers must treat a missing `baseURL` as "not
 * configured" — see `createNotesEmbeddingsProvider`.
 */
export function resolveEmbeddingConfig(): EmbeddingProviderConfig {
    if (process.env.EMBEDDING_API_BASE_URL) {
        const configuredModel = process.env.EMBEDDING_MODEL?.trim();
        return {
            apiKey: process.env.EMBEDDING_API_KEY,
            baseURL: process.env.EMBEDDING_API_BASE_URL,
            // Blank counts as unset, which `??` would not do.
            model:
                configuredModel !== undefined && configuredModel.length > 0
                    ? configuredModel
                    : DEFAULT_EMBEDDING_MODEL,
        };
    }

    if (process.env.AI_BASE_URL) {
        return {
            apiKey: process.env.AI_API_KEY ?? process.env.OPENAI_API_KEY,
            baseURL: process.env.AI_BASE_URL,
            model: DEFAULT_EMBEDDING_MODEL,
        };
    }

    return { apiKey: undefined, baseURL: undefined, model: DEFAULT_EMBEDDING_MODEL };
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
 * One configuration snapshot for the provider and model metadata used by
 * every note write and query against the fixed-width note vector table.
 */
export function resolveNoteEmbeddingRuntime(): NoteEmbeddingRuntime | null {
    const { apiKey, baseURL, model } = resolveEmbeddingConfig();
    if (!apiKey || !baseURL) return null;

    const config = {
        apiKey,
        baseUrl: baseURL,
        model,
        dimensions: EMBEDDING_DIM,
    };

    return {
        index: { ...NOTE_EMBEDDING_INDEX, model },
        embeddings: {
            embedQuery: async (query: string) => {
                const { embeddings } = await generateEmbeddings([query], config);
                return embeddings[0] ?? [];
            },
            embedDocuments: async (documents: string[]) => {
                const { embeddings } = await generateEmbeddings(documents, config);
                return embeddings;
            },
        },
    };
}

/**
 * The notes pipeline's one embeddings provider, generated through
 * @launchstack/llm's embedding service — no direct HTTP client here. Returns
 * null when no endpoint pair is configured so each caller keeps its own
 * skip/warn semantics (embedding a note is best-effort; searching without
 * an endpoint just returns nothing).
 */
export function createNotesEmbeddingsProvider(): EmbeddingsProvider | null {
    return resolveNoteEmbeddingRuntime()?.embeddings ?? null;
}
