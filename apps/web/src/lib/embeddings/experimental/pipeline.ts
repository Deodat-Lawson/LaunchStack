import { asc, eq } from "drizzle-orm";
import { db } from "~/server/db";
import { documentRetrievalChunks } from "@launchstack/core/db/schema";
import { ExperimentalEmbeddingClient } from "./client";
import { ExperimentalEmbeddingConfig, ExperimentalEmbeddingMetadata } from "./types";
import { storeExperimentalEmbeddings } from "./store";

const DEFAULT_ENDPOINT = process.env.EXPERIMENTAL_EMBEDDING_ENDPOINT ||
  (process.env.SIDECAR_URL ? `${process.env.SIDECAR_URL}/embed` : "");
const DEFAULT_PROVIDER = process.env.EXPERIMENTAL_EMBEDDING_PROVIDER || "sidecar";
const DEFAULT_MODEL = process.env.EXPERIMENTAL_EMBEDDING_MODEL || "bge-large-en-v1.5";
const DEFAULT_VERSION = process.env.EXPERIMENTAL_EMBEDDING_VERSION || "exp-v1";
const DEFAULT_DIMENSION = Number(process.env.EXPERIMENTAL_EMBEDDING_DIMENSION || "1024");

export interface ExperimentalPipelineOptions {
  documentId: number;
  endpoint?: string;
  provider?: string;
  model?: string;
  version?: string;
  dimension?: number;
  apiKey?: string;
  batchSize?: number;
}

export function resolveExperimentalConfig(overrides?: Partial<ExperimentalEmbeddingConfig>): ExperimentalEmbeddingConfig {
  const endpoint = overrides?.endpoint ?? DEFAULT_ENDPOINT;
  return {
    endpoint,
    provider: overrides?.provider ?? DEFAULT_PROVIDER,
    model: overrides?.model ?? DEFAULT_MODEL,
    version: overrides?.version ?? DEFAULT_VERSION,
    dimension: overrides?.dimension ?? DEFAULT_DIMENSION,
    apiKey: overrides?.apiKey,
    batchSize: overrides?.batchSize,
  };
}

export async function experimentalEmbedDocument(options: ExperimentalPipelineOptions): Promise<ExperimentalEmbeddingMetadata & { embeddedChunkCount: number }> {
  const { documentId, ...overrides } = options;
  const config = resolveExperimentalConfig(overrides);
  const client = new ExperimentalEmbeddingClient(config);

  const rows = await db
    .select({
      id: documentRetrievalChunks.id,
      content: documentRetrievalChunks.content,
    })
    .from(documentRetrievalChunks)
    .where(eq(documentRetrievalChunks.documentId, BigInt(documentId)))
    .orderBy(asc(documentRetrievalChunks.id));

  if (rows.length === 0) {
    throw new Error(`No retrieval chunks found for document ${documentId}`);
  }

  const texts = rows.map((row) => row.content ?? "");
  const chunkIds = rows.map((row) => Number(row.id));
  const { embeddings, dimension } = await client.embedTexts(texts);

  await storeExperimentalEmbeddings({
    documentId,
    retrievalChunkIds: chunkIds,
    vectors: embeddings,
    provider: config.provider,
    model: config.model,
    version: config.version,
    dimension,
  });

  return {
    provider: config.provider,
    model: config.model,
    version: config.version,
    dimension,
    embeddedChunkCount: rows.length,
  };
}

export async function experimentalEmbedQuery(
  text: string,
  overrides?: Partial<ExperimentalEmbeddingConfig>,
): Promise<{ vector: number[]; metadata: ExperimentalEmbeddingMetadata }> {
  const config = resolveExperimentalConfig(overrides);
  const client = new ExperimentalEmbeddingClient(config);
  const { embeddings, dimension } = await client.embedTexts([text]);
  const vector = embeddings[0];
  if (!vector) {
    throw new Error("Experimental query embedding failed: empty response");
  }

  return {
    vector,
    metadata: {
      provider: config.provider,
      model: config.model,
      version: config.version,
      dimension,
    },
  };
}
