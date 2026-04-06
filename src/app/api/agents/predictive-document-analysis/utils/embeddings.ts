import { LRUCache } from "lru-cache";
import { sanitizeErrorMessage } from "~/app/api/agents/predictive-document-analysis/utils/logging";
import { getEmbeddingsForCompany } from "~/lib/ai/embedding-factory";
import type { CompanyEmbeddingConfig } from "~/lib/ai/embedding-config";

const MAX_CACHE_ENTRIES = 500;

const embeddingCache = new LRUCache<string, number[]>({
    max: MAX_CACHE_ENTRIES,
});

export async function getEmbeddings(
    text: string,
    embeddingConfig?: CompanyEmbeddingConfig | null,
): Promise<number[]> {
    const cached = embeddingCache.get(text);
    if (cached) {
        return cached;
    }

    try {
        const embeddings = getEmbeddingsForCompany(embeddingConfig);

        const [embedding] = await embeddings.embedDocuments([text]);
        const result = embedding ?? [];

        embeddingCache.set(text, result);
        return result;
    } catch (error) {
        console.error("Error getting embeddings:", sanitizeErrorMessage(error));
        return [];
    }
}

export async function batchGetEmbeddings(
    texts: string[],
    embeddingConfig?: CompanyEmbeddingConfig | null,
): Promise<number[][]> {
    const uniqueTexts = [...new Set(texts)];

    try {
        const embeddings = getEmbeddingsForCompany(embeddingConfig);

        const results = await embeddings.embedDocuments(uniqueTexts);
        const embeddingMap = new Map(uniqueTexts.map((text, i) => [text, results[i]]));

        embeddingMap.forEach((embedding, text) => {
            embeddingCache.set(text, embedding ?? []);
        });

        return texts.map(text => embeddingMap.get(text) ?? []);
    } catch (error) {
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
