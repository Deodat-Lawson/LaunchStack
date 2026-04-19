import { ExperimentalEmbeddingConfig, EmbedTextsResult } from "./types";

interface EmbedRequestBody {
  texts: string[];
}

const DEFAULT_BATCH_SIZE = 64;

export class ExperimentalEmbeddingClient {
  private config: ExperimentalEmbeddingConfig;
  private batchSize: number;

  constructor(config: ExperimentalEmbeddingConfig) {
    if (!config.endpoint) {
      throw new Error("Experimental embedding endpoint is required");
    }
    this.config = config;
    this.batchSize = config.batchSize ?? DEFAULT_BATCH_SIZE;
  }

  get metadata() {
    const { provider, model, version, dimension } = this.config;
    return { provider, model, version, dimension };
  }

  async embedTexts(texts: string[]): Promise<EmbedTextsResult> {
    if (texts.length === 0) {
      return { embeddings: [], dimension: this.config.dimension };
    }

    const batches = this.createBatches(texts, this.batchSize);
    const embeddings: number[][] = [];
    for (const batch of batches) {
      const result = await this.callEndpoint(batch);
      if (result.dimension !== this.config.dimension) {
        throw new Error(
          `Experimental embedding dimension mismatch: expected ${this.config.dimension}, got ${result.dimension}`,
        );
      }
      embeddings.push(...result.embeddings);
    }

    if (embeddings.length !== texts.length) {
      throw new Error(
        `Experimental embedding result mismatch (expected ${texts.length}, received ${embeddings.length})`,
      );
    }

    return { embeddings, dimension: this.config.dimension };
  }

  private createBatches(texts: string[], size: number): string[][] {
    const batches: string[][] = [];
    for (let i = 0; i < texts.length; i += size) {
      batches.push(texts.slice(i, i + size));
    }
    return batches;
  }

  private async callEndpoint(texts: string[]): Promise<EmbedTextsResult> {
    const body: EmbedRequestBody = { texts };
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.config.apiKey) {
      headers.Authorization = `Bearer ${this.config.apiKey}`;
    }

    const response = await fetch(this.config.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Experimental embedding request failed (${response.status}): ${errorText}`,
      );
    }

    const data = (await response.json()) as { embeddings: number[][]; dimension?: number };
    if (!Array.isArray(data.embeddings)) {
      throw new Error("Experimental embedding response missing embeddings");
    }

    const dimension = data.dimension ?? this.config.dimension;
    return { embeddings: data.embeddings, dimension };
  }
}
