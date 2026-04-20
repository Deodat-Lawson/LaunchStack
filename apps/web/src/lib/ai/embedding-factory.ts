import { OllamaEmbeddings } from "@langchain/ollama";

import { generateEmbeddings } from "./embeddings";
import type { EmbeddingsProvider } from "~/lib/tools/rag/types";
import type { EmbeddingIndexConfig } from "./embedding-index-registry";
import {
  resolveEffectiveEmbeddingConfig,
  type CompanyEmbeddingConfig,
} from "./company-embedding-config";

/**
 * Module-level config holding the sidecar URL used by SidecarEmbeddings.
 * apps/web/src/server/engine.ts registers this at startup via
 * configureEmbeddingFactory; a process.env fallback is retained for the
 * transitional window before this file moves into @launchstack/core.
 */
export interface EmbeddingFactoryConfig {
  sidecarUrl?: string;
}

let _config: EmbeddingFactoryConfig | null = null;

export function configureEmbeddingFactory(config: EmbeddingFactoryConfig): void {
  _config = config;
}

function getSidecarUrl(): string | undefined {
  return _config?.sidecarUrl ?? process.env.SIDECAR_URL;
}

class SidecarEmbeddings implements EmbeddingsProvider {
  constructor(private readonly index: EmbeddingIndexConfig) {}

  async embedQuery(query: string): Promise<number[]> {
    const [vector] = await this.embedDocuments([query]);
    return vector ?? [];
  }

  async embedDocuments(documents: string[]): Promise<number[][]> {
    const sidecarUrl = getSidecarUrl();
    const endpoint = sidecarUrl ? `${sidecarUrl}/embed` : "";

    if (!endpoint) {
      throw new Error("SIDECAR_URL is required for sidecar embeddings");
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texts: documents }),
    });

    if (!response.ok) {
      throw new Error(
        `Sidecar embeddings request failed (${response.status}): ${await response.text()}`,
      );
    }

    const data = (await response.json()) as {
      embeddings?: number[][];
      dimension?: number;
    };

    if (!Array.isArray(data.embeddings)) {
      throw new Error("Sidecar embeddings response missing embeddings array");
    }

    validateEmbeddingDimension(
      this.index,
      data.dimension ?? this.index.dimension,
    );

    return data.embeddings;
  }
}

class HuggingFaceEmbeddings implements EmbeddingsProvider {
  constructor(
    private readonly index: EmbeddingIndexConfig,
    private readonly config?: CompanyEmbeddingConfig,
  ) {}

  async embedQuery(query: string): Promise<number[]> {
    const [vector] = await this.embedDocuments([query]);
    return vector ?? [];
  }

  async embedDocuments(documents: string[]): Promise<number[][]> {
    const apiKey = resolveEffectiveEmbeddingConfig(this.config).huggingFaceApiKey;
    if (!apiKey) {
      throw new Error(
        "HUGGINGFACE_API_KEY is required for Hugging Face embeddings",
      );
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
        },
      );

      if (!response.ok) {
        throw new Error(
          `Hugging Face embeddings request failed (${response.status}): ${await response.text()}`,
        );
      }

      const data = (await response.json()) as unknown;
      if (!Array.isArray(data) || !data.every((value) => typeof value === "number")) {
        throw new Error("Hugging Face embeddings response was not a number vector");
      }

      vectors.push(data as number[]);
    }

    return vectors;
  }
}

class ValidatedEmbeddingsProvider implements EmbeddingsProvider {
  constructor(
    private readonly inner: EmbeddingsProvider,
    private readonly index: EmbeddingIndexConfig,
  ) {}

  async embedQuery(query: string): Promise<number[]> {
    const vector = await this.inner.embedQuery(query);
    validateEmbeddingDimension(this.index, vector.length);
    return vector;
  }

  async embedDocuments(documents: string[]): Promise<number[][]> {
    if (!this.inner.embedDocuments) {
      return Promise.all(documents.map((doc) => this.embedQuery(doc)));
    }

    const vectors = await this.inner.embedDocuments(documents);
    for (const vector of vectors) {
      validateEmbeddingDimension(this.index, vector.length);
    }
    return vectors;
  }
}

function validateEmbeddingDimension(
  index: EmbeddingIndexConfig,
  actualDimension: number,
): void {
  if (actualDimension !== index.dimension) {
    throw new Error(
      `Embedding dimension mismatch for index "${index.indexKey}": expected ${index.dimension}, got ${actualDimension}`,
    );
  }
}

export function createEmbeddingModel(
  index: EmbeddingIndexConfig,
  config?: CompanyEmbeddingConfig,
): EmbeddingsProvider {
  const effectiveConfig = resolveEffectiveEmbeddingConfig(config);
  if (index.provider === "openai") {
    return {
      embedQuery: async (query: string) => {
        const result = await generateEmbeddings([query], {
          apiKey: effectiveConfig.openAIApiKey,
          model: index.model,
          dimensions: index.dimension,
        });
        return result.embeddings[0] ?? [];
      },
      embedDocuments: async (documents: string[]) => {
        const result = await generateEmbeddings(documents, {
          apiKey: effectiveConfig.openAIApiKey,
          model: index.model,
          dimensions: index.dimension,
        });
        return result.embeddings;
      },
    };
  }

  if (index.provider === "sidecar") {
    return new SidecarEmbeddings(index);
  }

  if (index.provider === "ollama") {
    return new ValidatedEmbeddingsProvider(
      new OllamaEmbeddings({
        baseUrl: effectiveConfig.ollamaBaseUrl,
        model: effectiveConfig.ollamaModel ?? index.model,
      }),
      index,
    );
  }

  return new ValidatedEmbeddingsProvider(
    new HuggingFaceEmbeddings(index, config),
    index,
  );
}
