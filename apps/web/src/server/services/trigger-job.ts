import { db } from "~/server/db";
import { ocrJobs } from "@launchstack/core/db/schema";
import { parseProvider, triggerDocumentProcessing } from "@launchstack/core/ocr/trigger";
import { getEngine } from "~/server/engine";

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
  const { jobId, eventIds } = await triggerDocumentProcessing(
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
  );

  await db.insert(ocrJobs).values({
    id: jobId,
    companyId: params.companyId,
    userId: params.userId,
    status: "queued",
    documentUrl: params.documentUrl,
    documentName: params.documentName,
  });

  return { jobId, eventIds };
}
