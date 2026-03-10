import { eq } from "drizzle-orm";

import {
  chunkPages,
  isKnownOfficeDocument,
  markJobFailed,
  normalizeDocument,
  routeDocument,
  storeDocument,
  vectorizeChunks,
  type NormalizationResult,
  type RouterDecisionResult,
  type StoredSection,
} from "~/lib/ocr/processor";
import { getTotalChunkSize } from "~/lib/ocr/chunker";
import type {
  DocumentChunk,
  PipelineResult,
  VectorizedChunk,
} from "~/lib/ocr/types";
import { db } from "~/server/db";
import { ocrJobs } from "~/server/db/schema";

import type {
  DocIngestionToolInput,
  DocIngestionToolResult,
  DocIngestionToolRuntimeOptions,
} from "./types";

const DEFAULT_SIDECAR_BATCH_SIZE = 50;

function splitIntoBatches<T>(arr: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    batches.push(arr.slice(i, i + size));
  }
  return batches;
}

function createStepRunner(runtime?: DocIngestionToolRuntimeOptions) {
  if (runtime?.runStep) {
    return async <T>(stepName: string, fn: () => Promise<T>): Promise<T> =>
      runtime.runStep?.(stepName, fn) ?? fn();
  }

  return async <T>(_stepName: string, fn: () => Promise<T>): Promise<T> => fn();
}

async function maybeMarkProcessing(
  jobId: string,
  shouldUpdateStatus: boolean,
): Promise<void> {
  if (!shouldUpdateStatus) return;

  await db
    .update(ocrJobs)
    .set({
      status: "processing",
      startedAt: new Date(),
    })
    .where(eq(ocrJobs.id, jobId));
}

function shouldUsePdfPipeline(mimeType: string | undefined, documentName: string): boolean {
  const isOffice = isKnownOfficeDocument(documentName);
  return (
    !isOffice &&
    (!mimeType ||
      mimeType === "application/pdf" ||
      documentName.toLowerCase().endsWith(".pdf"))
  );
}

async function vectorizeWithSidecar(
  chunks: DocumentChunk[],
  sidecarUrl: string,
  sidecarBatchSize: number,
  runStep: <T>(stepName: string, fn: () => Promise<T>) => Promise<T>,
): Promise<VectorizedChunk[]> {
  const batches = splitIntoBatches(chunks, sidecarBatchSize);
  const allEmbeddings: number[][] = [];

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    if (!batch) continue;

    const batchResult = await runStep(
      `step-d-embed-batch-${i}`,
      async (): Promise<number[][]> => {
        const texts = batch.map((chunk) => chunk.content);
        const response = await fetch(`${sidecarUrl}/embed`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ texts }),
        });

        if (!response.ok) {
          throw new Error(
            `Sidecar /embed failed (batch ${i}): ${response.status} ${await response.text()}`,
          );
        }

        const data = (await response.json()) as { embeddings: number[][] };
        return data.embeddings;
      },
    );

    allEmbeddings.push(...batchResult);
  }

  return chunks.map((chunk, idx) => ({
    content: chunk.content,
    metadata: chunk.metadata,
    vector: allEmbeddings[idx] ?? [],
  }));
}

async function maybeExtractEntities(
  sidecarUrl: string | undefined,
  storedSections: StoredSection[],
  documentId: number,
  companyId: string,
  runStep: <T>(stepName: string, fn: () => Promise<T>) => Promise<T>,
): Promise<void> {
  if (!sidecarUrl || storedSections.length === 0) return;

  await runStep("step-f-graph-rag", async () => {
    const sidecarHealthy = await fetch(`${sidecarUrl}/health`)
      .then((response) => response.ok)
      .catch(() => false);

    if (!sidecarHealthy) {
      console.warn("[DocIngestionTool] Step F skipped: sidecar unhealthy");
      return null;
    }

    const { extractAndStoreEntities } = await import(
      "~/lib/ingestion/entity-extraction"
    );

    const result = await extractAndStoreEntities(
      storedSections,
      documentId,
      BigInt(companyId),
    );

    console.log(
      `[DocIngestionTool] Graph RAG: ${result.totalEntities} entities, ` +
        `${result.totalRelationships} relationships stored`,
    );

    return result;
  });
}

function buildFailureResult(
  jobId: string,
  documentId: number,
  pipelineStartTime: number,
  error: unknown,
): PipelineResult {
  const elapsed = Date.now() - pipelineStartTime;

  return {
    success: false,
    jobId,
    documentId,
    chunks: [],
    metadata: {
      totalChunks: 0,
      textChunks: 0,
      tableChunks: 0,
      totalPages: 0,
      provider: "AZURE",
      processingTimeMs: elapsed,
      embeddingTimeMs: 0,
    },
    error: error instanceof Error ? error.message : String(error),
  };
}

/**
 * Shared backend tool for end-to-end document ingestion.
 * Runs OCR/normalization, chunking, embedding, storage, and optional graph extraction.
 */
export async function runDocIngestionTool(
  input: DocIngestionToolInput,
): Promise<DocIngestionToolResult> {
  const {
    jobId,
    documentUrl,
    documentId,
    documentName,
    companyId,
    mimeType,
    options,
    runtime,
  } = input;
  const pipelineStartTime = Date.now();

  const runStep = createStepRunner(runtime);
  const sidecarUrl = runtime?.sidecarUrl ?? process.env.SIDECAR_URL;
  const sidecarBatchSize = runtime?.sidecarBatchSize ?? DEFAULT_SIDECAR_BATCH_SIZE;
  const updateJobStatus = runtime?.updateJobStatus ?? false;
  const markFailureInDb = runtime?.markFailureInDb ?? false;

  try {
    await maybeMarkProcessing(jobId, updateJobStatus);

    const isPdf = shouldUsePdfPipeline(mimeType, documentName);
    let normalizationResult: NormalizationResult;

    if (isPdf) {
      const routerDecision = await runStep(
        "step-a-router",
        async (): Promise<RouterDecisionResult> =>
          routeDocument(documentUrl, options),
      );

      normalizationResult = await runStep(
        "step-b-normalize",
        async (): Promise<NormalizationResult> =>
          normalizeDocument(documentUrl, routerDecision),
      );
    } else {
      normalizationResult = await runStep(
        "step-ab-ingest",
        async (): Promise<NormalizationResult> => {
          const { ingestToNormalized } = await import("~/lib/ingestion");
          const normalizedDoc = await ingestToNormalized(documentUrl, {
            mimeType,
            filename: documentName,
            forceOCR: options?.forceOCR,
          });

          return {
            pages: normalizedDoc.pages,
            provider: normalizedDoc.metadata.provider,
            processingTimeMs: normalizedDoc.metadata.processingTimeMs,
            confidenceScore: normalizedDoc.metadata.confidenceScore,
          };
        },
      );
    }

    const chunks = await runStep(
      "step-c-chunking",
      async (): Promise<DocumentChunk[]> => chunkPages(normalizationResult.pages),
    );

    let vectorizedChunks: VectorizedChunk[];
    if (sidecarUrl && chunks.length > 0) {
      vectorizedChunks = await vectorizeWithSidecar(
        chunks,
        sidecarUrl,
        sidecarBatchSize,
        runStep,
      );
    } else {
      vectorizedChunks = await runStep(
        "step-d-vectorize",
        async (): Promise<VectorizedChunk[]> => vectorizeChunks(chunks),
      );
    }

    const storedSections = await runStep(
      "step-e-storage",
      async (): Promise<StoredSection[]> =>
        storeDocument(
          documentId,
          jobId,
          vectorizedChunks,
          normalizationResult,
          pipelineStartTime,
        ),
    );

    await maybeExtractEntities(
      sidecarUrl,
      storedSections,
      documentId,
      companyId,
      runStep,
    );

    const stats = getTotalChunkSize(chunks);
    const totalProcessingTime = Date.now() - pipelineStartTime;

    return {
      success: true,
      jobId,
      documentId,
      chunks: vectorizedChunks,
      metadata: {
        totalChunks: vectorizedChunks.length,
        textChunks: stats.textChunks,
        tableChunks: stats.tableChunks,
        totalPages: normalizationResult.pages.length,
        provider: normalizationResult.provider,
        processingTimeMs: normalizationResult.processingTimeMs,
        embeddingTimeMs: totalProcessingTime - normalizationResult.processingTimeMs,
      },
    };
  } catch (error) {
    if (markFailureInDb) {
      await markJobFailed(
        jobId,
        error instanceof Error ? error : new Error(String(error)),
      );
    }

    return buildFailureResult(jobId, documentId, pipelineStartTime, error);
  }
}

export type {
  DocIngestionToolInput,
  DocIngestionToolResult,
  DocIngestionToolRuntimeOptions,
} from "./types";
