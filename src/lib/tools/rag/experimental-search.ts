import { and, eq, sql } from "drizzle-orm";
import { db } from "~/server/db";
import {
  documentRetrievalChunks,
  experimentalDocumentEmbeddings,
} from "~/server/db/schema";
import type { SearchResult } from "./types";
import { experimentalEmbedQuery } from "~/lib/embeddings/experimental/pipeline";

export interface ExperimentalSearchOptions {
  documentId: number;
  topK?: number;
  provider?: string;
  model?: string;
  version?: string;
  dimension?: number;
}

const DEFAULT_TOP_K = 8;

export async function experimentalDocumentSearch(
  query: string,
  options: ExperimentalSearchOptions,
): Promise<SearchResult[]> {
  if (!query || query.trim().length === 0) {
    return [];
  }

  const topK = options.topK ?? DEFAULT_TOP_K;
  const { vector, metadata } = await experimentalEmbedQuery(query, options);
  const vectorLiteral = toVectorLiteral(vector, metadata.dimension);
  const queryVector = sql.raw(vectorLiteral);

  const rows = await db
    .select({
      chunkId: documentRetrievalChunks.id,
      documentId: documentRetrievalChunks.documentId,
      content: documentRetrievalChunks.content,
      pageNumber: documentRetrievalChunks.pageNumber,
      distance: sql<number>`(${experimentalDocumentEmbeddings.embedding} <-> ${queryVector})`,
    })
    .from(experimentalDocumentEmbeddings)
    .innerJoin(
      documentRetrievalChunks,
      eq(
        experimentalDocumentEmbeddings.retrievalChunkId,
        documentRetrievalChunks.id,
      ),
    )
    .where(
      and(
        eq(documentRetrievalChunks.documentId, BigInt(options.documentId)),
        eq(experimentalDocumentEmbeddings.provider, metadata.provider),
        eq(experimentalDocumentEmbeddings.model, metadata.model),
        eq(experimentalDocumentEmbeddings.version, metadata.version),
      ),
    )
    .orderBy(sql`(${experimentalDocumentEmbeddings.embedding} <-> ${queryVector})`)
    .limit(topK);

  return rows.map((row) => ({
    pageContent: row.content ?? "",
    metadata: {
      retrievalMethod: "experimental_vector" as const,
      searchScope: "document" as const,
      distance: row.distance,
      chunkId: Number(row.chunkId),
      page: row.pageNumber ?? undefined,
    },
  }));
}

function toVectorLiteral(values: number[], dimension: number): string {
  if (values.length !== dimension) {
    throw new Error(
      `Experimental vector literal dimension mismatch (expected ${dimension}, received ${values.length})`,
    );
  }
  const sanitized = values.map((value) => Number(value).toPrecision(8)).join(",");
  return `ARRAY[${sanitized}]::vector(${dimension})`;
}
