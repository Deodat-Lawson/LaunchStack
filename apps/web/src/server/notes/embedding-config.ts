import { generateEmbeddings, type EmbeddingsProvider } from "@launchstack/llm/embeddings";

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
 * `baseURL` also has no default on purpose: the embedding service rejects
 * missing endpoints rather than sending note text to a vendor nothing in this
 * configuration names. Callers must treat a missing `baseURL` as "not
 * configured" — see `createNotesEmbeddingsProvider`.
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
    const embeddings = createNotesEmbeddingsProvider();
    if (!embeddings) return null;

    return {
        embeddings,
        index: NOTE_EMBEDDING_INDEX,
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
