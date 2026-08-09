import { OpenAIEmbeddings } from "@langchain/openai";

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
 * `@langchain/openai` silently falls back to `api.openai.com` when
 * `configuration.baseURL` is undefined, so a key without an endpoint used to
 * ship document text to a vendor nothing here names. Both halves come from the
 * same source or the call fails.
 */
function resolveEmbeddingEndpoint(): { apiKey: string; baseURL: string } {
    const baseURL =
        process.env.EMBEDDING_API_BASE_URL ?? process.env.AI_BASE_URL;
    const apiKey = process.env.EMBEDDING_API_BASE_URL
        ? process.env.EMBEDDING_API_KEY
        : (process.env.AI_API_KEY ?? process.env.OPENAI_API_KEY);

    if (!baseURL || !apiKey) {
        throw new EmbeddingConfigurationError(
            "Embeddings are not configured. Set EMBEDDING_API_BASE_URL and " +
                "EMBEDDING_API_KEY (or AI_BASE_URL and AI_API_KEY). There is no " +
                "default endpoint: embeddings are persisted, so the provider " +
                "must be named explicitly.",
        );
    }
    return { apiKey, baseURL };
}
import { LRUCache } from "lru-cache";
import { sanitizeErrorMessage } from "~/app/api/agents/predictive-document-analysis/utils/logging";

const EMBEDDING_MODEL = "text-embedding-3-large";
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
        const { apiKey, baseURL } = resolveEmbeddingEndpoint();
        const embeddings = new OpenAIEmbeddings({
            openAIApiKey: apiKey,
            modelName: EMBEDDING_MODEL,
            dimensions: 1536,
            configuration: { baseURL },
        });

        const [embedding] = await embeddings.embedDocuments([text]);
        const result = embedding ?? [];
        
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
        const { apiKey, baseURL } = resolveEmbeddingEndpoint();
        const embeddings = new OpenAIEmbeddings({
            openAIApiKey: apiKey,
            modelName: EMBEDDING_MODEL,
            dimensions: 1536,
            configuration: { baseURL },
        });

        const results = await embeddings.embedDocuments(uniqueTexts);
        const embeddingMap = new Map(uniqueTexts.map((text, i) => [text, results[i]]));
        
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
