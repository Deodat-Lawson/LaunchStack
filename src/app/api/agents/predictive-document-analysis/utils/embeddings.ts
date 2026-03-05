import { OpenAIEmbeddings } from "@langchain/openai";
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
        const embeddings = new OpenAIEmbeddings({
            openAIApiKey: process.env.OPENAI_API_KEY,
            modelName: EMBEDDING_MODEL,
        });
        
        const [embedding] = await embeddings.embedDocuments([text]);
        const result = embedding ?? [];
        
        embeddingCache.set(text, result);
        return result;
    } catch (error) {
        console.error("Error getting embeddings:", sanitizeErrorMessage(error));
        return [];
    }
}

export async function batchGetEmbeddings(texts: string[]): Promise<number[][]> {
    const uniqueTexts = [...new Set(texts)];
    
    try {
        const embeddings = new OpenAIEmbeddings({
            openAIApiKey: process.env.OPENAI_API_KEY,
            modelName: EMBEDDING_MODEL,
        });
        
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
