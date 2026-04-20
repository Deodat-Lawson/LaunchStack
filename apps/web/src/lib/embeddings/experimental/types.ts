export interface ExperimentalEmbeddingMetadata {
  provider: string;
  model: string;
  version: string;
  dimension: number;
}

export interface ExperimentalEmbeddingConfig extends ExperimentalEmbeddingMetadata {
  /** Base URL for the experimental embedding service (e.g. sidecar). */
  endpoint: string;
  /** Optional API key header name/value pair. */
  apiKey?: string;
  /** Max number of texts per request. */
  batchSize?: number;
}

export interface EmbedTextsResult {
  embeddings: number[][];
  dimension: number;
}
