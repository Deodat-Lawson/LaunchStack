import { sql } from "drizzle-orm";

import { getDb } from "../db";
import {
  documentEmbeddings768,
  documentEmbeddings1024,
} from "../db/schema";
import type { EmbeddingIndexConfig } from "./index-registry";

interface StoreDimensionTableEmbeddingsInput {
  documentId: number;
  retrievalChunkIds: number[];
  vectors: number[][];
  index: EmbeddingIndexConfig;
}

function getDimensionTable(index: EmbeddingIndexConfig) {
  if (index.dimension === 768) {
    return documentEmbeddings768;
  }
  if (index.dimension === 1024) {
    return documentEmbeddings1024;
  }
  throw new Error(
    `No dimension table configured for index "${index.indexKey}" (${index.dimension} dims)`,
  );
}

export async function storeDimensionTableEmbeddings(
  input: StoreDimensionTableEmbeddingsInput,
): Promise<void> {
  const { documentId, retrievalChunkIds, vectors, index } = input;
  if (retrievalChunkIds.length !== vectors.length) {
    throw new Error("Retrieval chunk ids and embedding vector count mismatch");
  }
  for (const vector of vectors) {
    if (vector.length !== index.dimension) {
      throw new Error(
        `Embedding dimension mismatch for index "${index.indexKey}": expected ${index.dimension}, received ${vector.length}`,
      );
    }
  }

  const table = getDimensionTable(index);
  const rows = retrievalChunkIds.map((chunkId, idx) => ({
    documentId: BigInt(documentId),
    retrievalChunkId: BigInt(chunkId),
    indexKey: index.indexKey,
    provider: index.provider,
    model: index.model,
    version: index.version,
    embedding: vectors[idx]!,
  }));

  await getDb()
    .insert(table)
    .values(rows)
    .onConflictDoUpdate({
      target: [table.retrievalChunkId, table.indexKey],
      set: {
        provider: sql`excluded.provider`,
        model: sql`excluded.model`,
        version: sql`excluded.version`,
        documentId: sql`excluded.document_id`,
        embedding: sql`excluded.embedding`,
      },
    });

  console.log(
    `[EmbeddingStore] Upserted ${rows.length} vectors into ${index.dimension}-dim store for index=${index.indexKey} document=${documentId}`,
  );
}
