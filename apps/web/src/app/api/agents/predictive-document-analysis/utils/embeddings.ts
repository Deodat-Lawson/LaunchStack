/**
 * Query embeddings for predictive analysis, generated through
 * @launchstack/llm's embedding service (no private HTTP client here — this
 * file only resolves the feature's endpoint pair, caches, and sets error
 * semantics). Fixed at text-embedding-3-large / 1536 dims because every
 * similarity comparison this feature makes is against the legacy 1536-dim
 * `documentSections` / `documentRetrievalChunks` embeddings.
 */

import { generateEmbeddings } from "@launchstack/llm/embeddings";
import { LRUCache } from "lru-cache";
import { sanitizeErrorMessage } from "~/app/api/agents/predictive-document-analysis/utils/logging";

/**
 * Thrown when embeddings are not configured at all. Distinct from a transient
 * API failure: the callers below degrade to an empty vector on those, but a
 * misconfiguration must surface rather than masquerade as "nothing similar" —
 * an empty vector silently makes every similarity score meaningless.
 */
export class EmbeddingConfigurationError extends Error {
    override readonly name = "EmbeddingConfigurationError";
}

/**
 * Endpoint and credential, resolved as a PAIR.
 *
 * The llm embedding service deliberately has no default endpoint —
 * embeddings are persisted, so the provider must be named explicitly. Both
 * halves come from the same source or the call fails.
 */
function resolveEmbeddingEndpoint(): { apiKey: string; baseUrl: string } {
    const baseUrl = process.env.EMBEDDING_API_BASE_URL ?? process.env.AI_BASE_URL;
    const apiKey = process.env.EMBEDDING_API_BASE_URL
        ? process.env.EMBEDDING_API_KEY
        : (process.env.AI_API_KEY ?? process.env.OPENAI_API_KEY);

    if (!baseUrl || !apiKey) {
        throw new EmbeddingConfigurationError(
            "Embeddings are not configured. Set EMBEDDING_API_BASE_URL and " +
                "EMBEDDING_API_KEY (or AI_BASE_URL and AI_API_KEY). There is no " +
                "default endpoint: embeddings are persisted, so the provider " +
                "must be named explicitly."
        );
    }
    return { apiKey, baseUrl };
}

const EMBEDDING_MODEL = "text-embedding-3-large";
const EMBEDDING_DIMENSIONS = 1536;
const MAX_CACHE_ENTRIES = 500;

const embeddingCache = new LRUCache<string, number[]>({
    max: MAX_CACHE_ENTRIES,
});

export async function getEmbeddings(text: string): Promise<number[]> {
    const cached = embeddingCache.get(text);
    if (cached) {
        return cached;
    }

    try {
        const { apiKey, baseUrl } = resolveEmbeddingEndpoint();
        const { embeddings } = await generateEmbeddings([text], {
            apiKey,
            baseUrl,
            model: EMBEDDING_MODEL,
            dimensions: EMBEDDING_DIMENSIONS,
        });
        const result = embeddings[0] ?? [];

        embeddingCache.set(text, result);
        return result;
    } catch (error) {
        // A missing endpoint is not a transient failure — returning [] here
        // would let predictive analysis run on meaningless similarity scores
        // and report success.
        if (error instanceof EmbeddingConfigurationError) throw error;
        console.error("Error getting embeddings:", sanitizeErrorMessage(error));
        return [];
    }
}

export async function batchGetEmbeddings(texts: string[]): Promise<number[][]> {
    const uniqueTexts = [...new Set(texts)];

    try {
        const { apiKey, baseUrl } = resolveEmbeddingEndpoint();
        const { embeddings } = await generateEmbeddings(uniqueTexts, {
            apiKey,
            baseUrl,
            model: EMBEDDING_MODEL,
            dimensions: EMBEDDING_DIMENSIONS,
        });
        const embeddingMap = new Map(uniqueTexts.map((text, i) => [text, embeddings[i]]));

        embeddingMap.forEach((embedding, text) => {
            embeddingCache.set(text, embedding ?? []);
        });

        return texts.map(text => embeddingMap.get(text) ?? []);
    } catch (error) {
        // See getEmbeddings: a misconfiguration must not degrade into a batch
        // of empty vectors that analysis then treats as real scores.
        if (error instanceof EmbeddingConfigurationError) throw error;
        console.error("Error getting batch embeddings:", sanitizeErrorMessage(error));
        return texts.map(() => []);
    }
}

export function clearEmbeddingCache(): void {
    embeddingCache.clear();
}

export function getEmbeddingCacheStats() {
    return {
        size: embeddingCache.size,
        maxSize: MAX_CACHE_ENTRIES,
    };
}
