/**
 * The embedding models the pools can be replayed with. The local one is what
 * the benchmark was recorded with; the other two are the app's built-in
 * indexes, read from the registry it resolves its embedder from, so a replay
 * uses the model and the dimensions a deployment does.
 */
import { generateEmbeddings, resolveEmbeddingIndex } from "@launchstack/llm/embeddings";

import { cachedEmbedder, LOCAL_MODEL, type ReplayEmbedder } from "./vectors";

/** Where a recording sends its texts: an OpenAI-compatible embeddings endpoint. */
export interface ReplayRoute {
    baseUrl: string;
    /** The model's id on that endpoint. */
    model: string;
    /** Environment variables that may hold the key; the first one set wins. */
    keyEnv: readonly string[];
}

export interface ReplayModel {
    /** The cache's name for the model. */
    id: string;
    /** What a reader should call it. */
    label: string;
    /** The app's embedding index it is (packages/llm/src/embeddings/index-registry.ts); null for the local model. */
    indexKey: string | null;
    /**
     * Endpoints that serve the model, by name. `direct` is the vendor's own.
     * `openrouter` serves the same model at the same list price; it is there
     * for a key whose direct quota is too small to record a pool (the free
     * tier of Google's endpoint takes 100 texts a minute).
     */
    routes?: Readonly<Record<string, ReplayRoute>>;
    /** List price in US dollars per million input tokens, for the estimate a recording prints. */
    usdPerMTok?: number;
}

const OPENROUTER = "https://openrouter.ai/api/v1";

export const REPLAY_MODELS: readonly ReplayModel[] = [
    {
        id: LOCAL_MODEL,
        label: "nomic-embed-text (local, the benchmark's model)",
        indexKey: null,
    },
    {
        id: "gemini-embedding-001@768",
        label: "gemini-embedding-001 at 768 dimensions (index gemini-embedding-768, the one the registry recommends)",
        indexKey: "gemini-embedding-768",
        routes: {
            direct: {
                baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
                model: "gemini-embedding-001",
                keyEnv: ["GOOGLE_AI_API_KEY"],
            },
            openrouter: {
                baseUrl: OPENROUTER,
                model: "google/gemini-embedding-001",
                keyEnv: ["OPENROUTER_API_KEY"],
            },
        },
        usdPerMTok: 0.15,
    },
    {
        id: "text-embedding-3-large@1536",
        label: "text-embedding-3-large at 1536 dimensions (index legacy-openai-1536, the default)",
        indexKey: "legacy-openai-1536",
        routes: {
            direct: {
                baseUrl: "https://api.openai.com/v1",
                model: "text-embedding-3-large",
                keyEnv: ["EMBEDDING_API_KEY", "OPENAI_API_KEY"],
            },
            openrouter: {
                baseUrl: OPENROUTER,
                model: "openai/text-embedding-3-large",
                keyEnv: ["OPENROUTER_API_KEY"],
            },
        },
        usdPerMTok: 0.13,
    },
];

export function replayModel(id: string): ReplayModel {
    const model = REPLAY_MODELS.find(m => m.id === id);
    if (!model)
        throw new Error(`Unknown model "${id}". Known: ${REPLAY_MODELS.map(m => m.id).join(", ")}`);
    return model;
}

/** Reads cached vectors only: a replay never calls a model. */
export function offlineEmbedder(id: string): ReplayEmbedder {
    return cachedEmbedder({ model: replayModel(id).id });
}

export interface RecordingEmbedder extends ReplayEmbedder {
    /** Tokens as the provider counted them, or the client's estimate where it reports none. */
    readonly spent: { tokens: number; requests: number };
}

/**
 * Computes what the cache lacks with production's own client and the
 * registry's dimensions. Paid: only record.ts builds one, after its checks.
 * `cache: false` computes without reading or writing the cache (the check
 * that two routes return the same vectors).
 */
export function recordingEmbedder(
    id: string,
    options: {
        route?: string;
        env?: Record<string, string | undefined>;
        cache?: boolean;
    } = {}
): RecordingEmbedder {
    const model = replayModel(id);
    const route = model.routes?.[options.route ?? "direct"];
    if (!model.indexKey || !route)
        throw new Error(
            model.routes
                ? `${model.id} has no route "${options.route}". Known: ${Object.keys(model.routes).join(", ")}`
                : `${model.id} is the local model: ../e4-whom-to-check/record.ts records it`
        );
    const index = resolveEmbeddingIndex(model.indexKey);
    const env = options.env ?? process.env;
    const apiKey = route.keyEnv.map(name => env[name]).find(Boolean);
    if (!apiKey) throw new Error(`None of ${route.keyEnv.join(", ")} is set`);
    const spent = { tokens: 0, requests: 0 };
    const compute = async (texts: string[]): Promise<number[][]> => {
        const result = await generateEmbeddings(texts, {
            apiKey,
            baseUrl: route.baseUrl,
            model: route.model,
            dimensions: index.dimension,
            concurrency: 2,
        });
        spent.tokens += result.totalTokens;
        spent.requests += result.batchCount;
        return result.embeddings;
    };
    if (options.cache === false)
        return {
            model: model.id,
            stats: { cached: 0, computed: 0 },
            spent,
            embed: texts => compute(texts.map(t => t.slice(0, 2_000))),
        };
    return Object.assign(cachedEmbedder({ model: model.id, compute }), { spent });
}
