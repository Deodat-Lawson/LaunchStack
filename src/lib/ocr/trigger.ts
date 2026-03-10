/**
 * Pipeline Trigger Utilities
 * Helper functions to invoke the OCR-to-Vector pipeline
 *
 * Always dispatches via the configured job runner (JOB_RUNNER, default: Inngest).
 * INNGEST_EVENT_KEY is required. On dispatch failure, throws (no sync fallback).
 */

import { env } from "~/env";
import type { ProcessDocumentEventData, OCRProvider } from "./types";

/**
 * Options for triggering the document processing pipeline
 */
export interface TriggerOptions {
  /** Force OCR even for native PDFs */
  forceOCR?: boolean;
  /** Preferred OCR provider */
  preferredProvider?: OCRProvider;
  /** MIME type of the uploaded file — forwarded to the ingestion router */
  mimeType?: string;
}

/**
 * Check if the sidecar ML service is available
 */
export function isSidecarEnabled(): boolean {
  return !!process.env.SIDECAR_URL;
}

/**
 * Trigger the OCR-to-Vector pipeline for a document.
 *
 * Dispatches via the configured job runner (Inngest or Trigger.dev).
 * Throws on dispatch failure; no sync fallback.
 */
export async function triggerDocumentProcessing(
  documentUrl: string,
  documentName: string,
  companyId: string,
  userId: string,
  documentId: number,
  category: string,
  options?: TriggerOptions
): Promise<{ jobId: string; eventIds: string[] }> {
  const jobId = generateJobId();

  const eventData: ProcessDocumentEventData = {
    jobId,
    documentUrl,
    documentName,
    companyId,
    userId,
    documentId,
    category,
    mimeType: options?.mimeType,
    options: {
      forceOCR: options?.forceOCR,
      preferredProvider: options?.preferredProvider,
    },
  };

  console.log(
    `[Trigger] Dispatching job=${jobId}, doc="${documentName}", docId=${documentId}, ` +
    `mime=${options?.mimeType ?? "none"}, provider=${options?.preferredProvider ?? "auto"}, ` +
    `runner=${env.server.JOB_RUNNER ?? "inngest"}`
  );

  const { getDispatcher } = await import("~/lib/jobs");
  const dispatcher = getDispatcher();

  try {
    const result = await dispatcher.dispatch(eventData);

    console.log(
      `[Trigger] Successfully queued job=${jobId} via ${dispatcher.name}, ` +
      `eventIds=${result.eventIds.length}`
    );
    return result;
  } catch (error) {
    console.error(`[Trigger] Job dispatch failed for job=${jobId}:`, error);
    throw new Error(
      `Job dispatch failed for job=${jobId}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Generate a unique job ID
 */
function generateJobId(): string {
  const timestamp = Date.now().toString(36);
  const randomPart = Math.random().toString(36).substring(2, 10);
  return `ocr-${timestamp}-${randomPart}`;
}

/**
 * Parse a provider string to OCRProvider type
 */
export function parseProvider(provider?: string): OCRProvider | undefined {
  if (!provider) return undefined;

  const normalized = provider.toUpperCase();
  const validProviders: OCRProvider[] = ["AZURE", "LANDING_AI", "NATIVE_PDF", "DATALAB"];

  if (validProviders.includes(normalized as OCRProvider)) {
    return normalized as OCRProvider;
  }

  return undefined;
}
