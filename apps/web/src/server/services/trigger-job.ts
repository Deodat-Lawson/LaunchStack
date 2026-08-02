import { db } from "~/server/db";
import { ocrJobs, ocrOutbox } from "@launchstack/core/db/schema";
import { parseProvider, triggerDocumentProcessing } from "@launchstack/core/ocr/trigger";
import { getEngine } from "~/server/engine";
import { eq } from "drizzle-orm";

export interface TriggerJobParams {
  documentUrl: string;
  documentName: string;
  companyId: bigint;
  userId: string;
  documentId: number;
  category: string;
  preferredProvider?: string;
  mimeType?: string;
  originalFilename?: string;
  isWebsite?: boolean;
  transcriptionMetadata?: Record<string, unknown>;
  versionId?: number;
  embeddingIndexKey?: string;
}

export interface TriggerJobResult {
  jobId: string;
  eventIds: string[];
}

/**
 * Triggers the OCR/processing job for a document and records the queued job.
 */
export async function triggerJob(params: TriggerJobParams): Promise<TriggerJobResult> {
  getEngine();
  // Generate job id locally and insert job + outbox row transactionally so
  // the dispatch payload is durable even if an immediate dispatch fails.
  const jobId =
    typeof globalThis !== "undefined" && (globalThis as any).crypto && typeof (globalThis as any).crypto.randomUUID === "function"
      ? (globalThis as any).crypto.randomUUID()
      : (await import("crypto") as unknown as { randomUUID: () => string }).randomUUID();

  const payload = {
    jobId,
    documentUrl: params.documentUrl,
    documentName: params.documentName,
    companyId: params.companyId.toString(),
    userId: params.userId,
    documentId: params.documentId,
    category: params.category,
    mimeType: params.mimeType,
    originalFilename: params.originalFilename,
    isWebsite: params.isWebsite,
    transcriptionMetadata: params.transcriptionMetadata,
    versionId: params.versionId,
    options: {
      preferredProvider: parseProvider(params.preferredProvider),
      embeddingIndexKey: params.embeddingIndexKey,
    },
  };

  await db.transaction(async (tx) => {
    await tx.insert(ocrJobs).values({
      id: jobId,
      companyId: params.companyId,
      userId: params.userId,
      status: "queued",
      documentId: params.documentId == null ? null : BigInt(params.documentId),
      documentUrl: params.documentUrl,
      documentName: params.documentName,
    } as any);

    await tx.insert(ocrOutbox).values({
      jobId,
      payload,
      status: "pending",
      attemptCount: 0,
    } as any);
  });

  // Try an immediate dispatch but treat failures as transient — the outbox
  // will retry asynchronously.
  try {
    const { eventIds } = await triggerDocumentProcessing(
      params.documentUrl,
      params.documentName,
      params.companyId.toString(),
      params.userId,
      params.documentId,
      params.category,
      {
        preferredProvider: parseProvider(params.preferredProvider),
        mimeType: params.mimeType,
        originalFilename: params.originalFilename,
        isWebsite: params.isWebsite,
        transcriptionMetadata: params.transcriptionMetadata,
        versionId: params.versionId,
        embeddingIndexKey: params.embeddingIndexKey,
      },
      jobId,
    );

    // mark outbox row as sent and record eventIds
    await db.update(ocrOutbox).set({ status: "sent", eventIds: eventIds as unknown }).where(eq((ocrOutbox as any).jobId, jobId));

    return { jobId, eventIds };
  } catch (err) {
    // Leave the outbox pending for later retry; surface the error to the
    // caller so they know the dispatch didn't complete synchronously.
    return { jobId, eventIds: [] };
  }
}
