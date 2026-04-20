import { sql } from "drizzle-orm";
import { db } from "~/server/db";
import { experimentalDocumentEmbeddings } from "~/server/db/schema";
import { ExperimentalEmbeddingMetadata } from "./types";

export interface StoreEmbeddingsInput extends ExperimentalEmbeddingMetadata {
  documentId: number;
  retrievalChunkIds: number[];
  vectors: number[][];
}

export async function storeExperimentalEmbeddings(input: StoreEmbeddingsInput): Promise<void> {
  const { documentId, retrievalChunkIds, vectors, provider, model, version, dimension } = input;
  if (retrievalChunkIds.length !== vectors.length) {
    throw new Error("Retrieval chunk ids and embedding vector count mismatch");
  }

  const rows = retrievalChunkIds.map((chunkId, idx) => ({
    documentId: BigInt(documentId),
    retrievalChunkId: BigInt(chunkId),
    provider,
    model,
    version,
    dimension,
    embedding: vectors[idx]!,
  }));

  await db
    .insert(experimentalDocumentEmbeddings)
    .values(rows)
    .onConflictDoUpdate({
      target: [
        experimentalDocumentEmbeddings.retrievalChunkId,
        experimentalDocumentEmbeddings.provider,
        experimentalDocumentEmbeddings.model,
        experimentalDocumentEmbeddings.version,
      ],
      set: {
        embedding: sql`excluded.embedding`,
        dimension: sql`excluded.dimension`,
        documentId: sql`excluded.document_id`,
      },
    });
}
