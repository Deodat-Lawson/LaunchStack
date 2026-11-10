import {
    companyEmbeddingText,
    hashValue,
    type PastCompany,
} from "@launchstack/pipelines/accelerators";
import { generateEmbeddings } from "@launchstack/llm/embeddings";

import { EMBEDDING_DIM, resolveEmbeddingConfig } from "~/server/notes/embedding-config";

export interface SimilarCompanyEmbeddings {
    model: string;
    embed(texts: string[]): Promise<number[][]>;
    /** Changes when the company's text or the model changes, so stale vectors are redone. */
    hashOf(company: PastCompany): string;
}

/**
 * Past companies and the Core profile must be embedded by the same model to be
 * comparable. Both use the 1536-wide endpoint pair the notes pipeline resolves.
 */
export function similarCompanyEmbeddings(): SimilarCompanyEmbeddings {
    const { apiKey, baseURL, model } = resolveEmbeddingConfig();
    if (!apiKey || !baseURL) {
        throw new Error(
            "Embeddings are not configured: set EMBEDDING_API_BASE_URL and EMBEDDING_API_KEY"
        );
    }
    const config = { apiKey, baseUrl: baseURL, model, dimensions: EMBEDDING_DIM };
    return {
        model,
        embed: async texts => (await generateEmbeddings(texts, config)).embeddings,
        hashOf: company =>
            hashValue({ model, dimension: EMBEDDING_DIM, text: companyEmbeddingText(company) }),
    };
}
