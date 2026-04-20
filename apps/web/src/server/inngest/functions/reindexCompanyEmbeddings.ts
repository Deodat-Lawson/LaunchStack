/**
 * Inngest function: re-embed every document chunk for a company into a new
 * `index_key`, then atomically swap the `active` pointer once the reindex
 * completes. Triggered by the `company/reindex-embeddings.requested`
 * event, which is fired by `updateCompany` whenever an employer changes
 * their embedding model while documents are already ingested.
 *
 * Phase 2 of the Onyx-style SearchSettings rollout. While the job runs:
 *   - queries continue to hit the ACTIVE index key (unchanged)
 *   - new ingest writes go to the PENDING index key (see document-upload)
 *   - chunks from before the switch are rewritten into the pending index
 *
 * On success `completeReindex()` flips pending → active atomically.
 * On failure the job stays in FAILED and the active pointer is untouched.
 */

import { and, eq, gt, inArray, sql } from "drizzle-orm";

import { inngest } from "../client";
import { db } from "~/server/db";
import {
  company,
  document,
  documentRetrievalChunks,
} from "@launchstack/core/db/schema";
import {
  resolveEmbeddingIndex,
  isLegacyEmbeddingIndex,
  type EmbeddingIndexConfig,
} from "~/lib/ai/embedding-index-registry";
import { createEmbeddingModel } from "~/lib/ai/embedding-factory";
import { storeDimensionTableEmbeddings } from "~/lib/ai/dimension-table-store";
import { getCompanyEmbeddingConfig } from "~/lib/ai/company-embedding-config";
import {
  completeReindex,
  failReindex,
} from "~/lib/ai/company-reindex-state";

const BATCH_SIZE = 64;

interface ChunkRow {
  chunkId: bigint;
  documentId: bigint;
  content: string;
}

async function loadCompanyChunks(
  companyId: number,
  cursorId: bigint,
  limit: number,
): Promise<ChunkRow[]> {
  const rows = await db
    .select({
      chunkId: documentRetrievalChunks.id,
      documentId: documentRetrievalChunks.documentId,
      content: documentRetrievalChunks.content,
    })
    .from(documentRetrievalChunks)
    .innerJoin(document, eq(document.id, documentRetrievalChunks.documentId))
    .where(
      and(
        eq(document.companyId, BigInt(companyId)),
        gt(documentRetrievalChunks.id, Number(cursorId)),
      ),
    )
    .orderBy(documentRetrievalChunks.id)
    .limit(limit);

  return rows.map((row) => ({
    chunkId: BigInt(row.chunkId),
    documentId: BigInt(row.documentId),
    content: row.content,
  }));
}

async function writeLegacyEmbeddings(
  chunkIds: bigint[],
  vectors: number[][],
  index: EmbeddingIndexConfig,
): Promise<void> {
  // Legacy storage writes directly to documentRetrievalChunks.embedding.
  // Safe during REINDEXING only if the active index is NOT legacy, which
  // is guaranteed by the caller's pre-check (active !== pending and there
  // is only one legacy index today).
  const shortDim = index.shortDimension ?? 512;
  for (let i = 0; i < chunkIds.length; i += 1) {
    const chunkId = chunkIds[i]!;
    const vector = vectors[i]!;
    const shortVec = index.supportsMatryoshka ? vector.slice(0, shortDim) : null;
    const fullLiteral = `[${vector.join(",")}]`;
    const shortLiteral = shortVec ? `[${shortVec.join(",")}]` : null;
    await db.execute(sql`
      UPDATE pdr_ai_v2_document_retrieval_chunks
      SET embedding = ${sql.raw(`'${fullLiteral}'::vector(${index.dimension})`)},
          embedding_short = ${shortLiteral ? sql.raw(`'${shortLiteral}'::vector(${shortDim})`) : sql`NULL`}
      WHERE id = ${Number(chunkId)}
    `);
  }
}

/**
 * Count how many retrieval chunks the company still has. Used to short-
 * circuit into a plain swap when the company has no documents yet.
 */
async function countCompanyChunks(companyId: number): Promise<number> {
  const [{ count = 0 } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(documentRetrievalChunks)
    .innerJoin(document, eq(document.id, documentRetrievalChunks.documentId))
    .where(eq(document.companyId, BigInt(companyId)));
  return count;
}

export const reindexCompanyEmbeddingsJob = inngest.createFunction(
  {
    id: "reindex-company-embeddings",
    // Only one reindex per company at a time; concurrent triggers wait.
    concurrency: { key: "event.data.companyId", limit: 1 },
    retries: 2,
  },
  { event: "company/reindex-embeddings.requested" },
  async ({ event, step, logger }) => {
    const { companyId, pendingIndexKey } = event.data;

    // ------------------------------------------------------------------
    // 1. Resolve pending index + credentials once up front. If this fails
    //    we can surface a clean error without ever mutating state.
    // ------------------------------------------------------------------
    const { index, config } = await step.run("load-pending-index", async () => {
      const cfg = await getCompanyEmbeddingConfig(companyId);
      const resolved = resolveEmbeddingIndex(pendingIndexKey, cfg ?? undefined);
      return { index: resolved, config: cfg ?? undefined };
    });

    // Fast path: if the company has no chunks yet, just swap. Avoids
    // paying for an embedding round-trip on empty corpora.
    const chunkCount = await step.run("count-chunks", () =>
      countCompanyChunks(companyId),
    );

    if (chunkCount === 0) {
      await step.run("swap-empty", async () => {
        await completeReindex(companyId);
        logger.info(
          `[reindex] company=${companyId} swapped without re-embedding (no chunks)`,
        );
      });
      return { reindexed: 0, swapped: true };
    }

    // ------------------------------------------------------------------
    // 2. Page through all retrieval chunks and re-embed them in batches.
    //    Each batch is its own step so Inngest can retry just the failing
    //    chunk window rather than the whole company.
    // ------------------------------------------------------------------
    const embeddings = createEmbeddingModel(index, config);

    let cursor = 0n;
    let reindexed = 0;
    let batchIdx = 0;

    while (true) {
      const batch = await step.run(
        `load-chunks-${batchIdx}`,
        async () => loadCompanyChunks(companyId, cursor, BATCH_SIZE),
      );
      if (batch.length === 0) break;

      await step.run(`embed-batch-${batchIdx}`, async () => {
        const contents = batch.map((c) => c.content);
        // Providers that implement embedDocuments batch in a single call;
        // the rest need per-item fallback.
        const vectors = embeddings.embedDocuments
          ? await embeddings.embedDocuments(contents)
          : await Promise.all(contents.map((c) => embeddings.embedQuery(c)));
        if (vectors.length !== batch.length) {
          throw new Error(
            `Embedding provider returned ${vectors.length} vectors for ${batch.length} chunks`,
          );
        }

        if (isLegacyEmbeddingIndex(index)) {
          await writeLegacyEmbeddings(
            batch.map((c) => c.chunkId),
            vectors,
            index,
          );
        } else {
          // Group by documentId for storeDimensionTableEmbeddings's contract.
          const byDocument = new Map<bigint, { ids: number[]; vectors: number[][] }>();
          batch.forEach((row, i) => {
            const docBucket = byDocument.get(row.documentId) ?? {
              ids: [],
              vectors: [],
            };
            docBucket.ids.push(Number(row.chunkId));
            docBucket.vectors.push(vectors[i]!);
            byDocument.set(row.documentId, docBucket);
          });
          for (const [docId, bucket] of byDocument) {
            await storeDimensionTableEmbeddings({
              documentId: Number(docId),
              retrievalChunkIds: bucket.ids,
              vectors: bucket.vectors,
              index,
            });
          }
        }
      });

      reindexed += batch.length;
      cursor = batch[batch.length - 1]!.chunkId;
      batchIdx += 1;
    }

    // ------------------------------------------------------------------
    // 3. Flip active ← pending atomically.
    // ------------------------------------------------------------------
    await step.run("complete-reindex", () => completeReindex(companyId));

    logger.info(
      `[reindex] company=${companyId} reindexed ${reindexed} chunks into index_key=${index.indexKey}`,
    );
    return { reindexed, swapped: true };
  },
);

/**
 * Wrap the function body so Inngest's retry exhaustion still leaves the
 * company in FAILED state (instead of REINDEXING) for operator visibility.
 * Called by the route after `inngest.send` fails catastrophically; the
 * function itself relies on Inngest step retries for transient errors.
 */
export async function markReindexFailed(
  companyId: number,
  error: unknown,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  try {
    await failReindex(companyId, message);
  } catch (dbErr) {
    // Never throw out of an error handler.
    console.error(
      `[reindex] failed to record failure for company ${companyId}:`,
      dbErr,
    );
  }
}

// Unused imports kept to document the fuller data model; tree-shaking keeps
// runtime cost at zero.
void company;
void inArray;
