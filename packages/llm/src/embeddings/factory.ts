import { OllamaEmbeddings } from "@langchain/ollama";

import { generateEmbeddings } from "./embeddings";
import type { EmbeddingsProvider } from "./types";
import type { EmbeddingIndexConfig } from "./index-registry";
import { resolveEffectiveEmbeddingConfig, type CompanyEmbeddingConfig } from "./company-config";

// The sidecar embeddings provider was removed (ADR-004 §5): it posted to
// ${SIDECAR_URL}/embed, a route no service in this repository ever
// implemented, so it could only 404 at runtime.

class HuggingFaceEmbeddings implements EmbeddingsProvider {
    constructor(
        private readonly index: EmbeddingIndexConfig,
        private readonly config?: CompanyEmbeddingConfig
    ) {}

    async embedQuery(query: string): Promise<number[]> {
        const [vector] = await this.embedDocuments([query]);
        return vector ?? [];
    }

    async embedDocuments(documents: string[]): Promise<number[][]> {
        const apiKey = resolveEffectiveEmbeddingConfig(this.config).huggingFaceApiKey;
        if (!apiKey) {
            throw new Error("HUGGINGFACE_API_KEY is required for Hugging Face embeddings");
        }

        const vectors: number[][] = [];
        for (const document of documents) {
            const response = await fetch(
                `https://api-inference.huggingface.co/models/${this.index.model}`,
                {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${apiKey}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        inputs: document,
                        options: { wait_for_model: true },
                    }),
                }
            );

            if (!response.ok) {
                throw new Error(
                    `Hugging Face embeddings request failed (${response.status}): ${await response.text()}`
                );
            }

            const data = (await response.json()) as unknown;
            if (!Array.isArray(data) || !data.every(value => typeof value === "number")) {
                throw new Error("Hugging Face embeddings response was not a number vector");
            }

            vectors.push(data);
        }

        return vectors;
    }
}

class ValidatedEmbeddingsProvider implements EmbeddingsProvider {
    constructor(
        private readonly inner: EmbeddingsProvider,
        private readonly index: EmbeddingIndexConfig
    ) {}

    async embedQuery(query: string): Promise<number[]> {
        const vector = await this.inner.embedQuery(query);
        validateEmbeddingDimension(this.index, vector.length);
        return vector;
    }

    async embedDocuments(documents: string[]): Promise<number[][]> {
        if (!this.inner.embedDocuments) {
            return Promise.all(documents.map(doc => this.embedQuery(doc)));
        }

        const vectors = await this.inner.embedDocuments(documents);
        for (const vector of vectors) {
            validateEmbeddingDimension(this.index, vector.length);
        }
        return vectors;
    }
}

function validateEmbeddingDimension(index: EmbeddingIndexConfig, actualDimension: number): void {
    if (actualDimension !== index.dimension) {
        throw new Error(
            `Embedding dimension mismatch for index "${index.indexKey}": expected ${index.dimension}, got ${actualDimension}`
        );
    }
}

export function createEmbeddingModel(
    index: EmbeddingIndexConfig,
    config?: CompanyEmbeddingConfig
): EmbeddingsProvider {
    const effectiveConfig = resolveEffectiveEmbeddingConfig(config);
    if (index.provider === "openai") {
        return {
            embedQuery: async (query: string) => {
                const result = await generateEmbeddings([query], {
                    apiKey: effectiveConfig.openAIApiKey,
                    baseUrl: effectiveConfig.openAIBaseUrl,
                    model: index.model,
                    dimensions: index.dimension,
                });
                return result.embeddings[0] ?? [];
            },
            embedDocuments: async (documents: string[]) => {
                const result = await generateEmbeddings(documents, {
                    apiKey: effectiveConfig.openAIApiKey,
                    baseUrl: effectiveConfig.openAIBaseUrl,
                    model: index.model,
                    dimensions: index.dimension,
                });
                return result.embeddings;
            },
        };
    }

    if (index.provider === "ollama") {
        return new ValidatedEmbeddingsProvider(
            new OllamaEmbeddings({
                baseUrl: effectiveConfig.ollamaBaseUrl,
                model: effectiveConfig.ollamaModel ?? index.model,
            }),
            index
        );
    }

    return new ValidatedEmbeddingsProvider(new HuggingFaceEmbeddings(index, config), index);
}
