import { eq } from "drizzle-orm";
import { db } from "~/server/db";
import { document, ocrJobs } from "@launchstack/core/db/schema";
import type { ProcessDocumentEventData } from "@launchstack/core/ocr/types";

export async function handleProcessDocumentFailure({
  error,
  event,
}: {
  error: unknown;
  event: { data?: { event?: { data?: ProcessDocumentEventData } } };
}): Promise<void> {
  console.error(`[ProcessDocument] Pipeline failed for job ${JSON.stringify(event.data)}:`, error);
  const data = event.data?.event?.data as ProcessDocumentEventData | undefined;
  const errorMessage = error instanceof Error ? error.message : String(error);

  if (data?.documentId) {
    try {
      await db
        .update(document)
        .set({
          ocrProcessed: false,
          ocrMetadata: {
            error: "processing_failed",
            errorMessage,
            failedAt: new Date().toISOString(),
          },
        })
        .where(eq(document.id, data.documentId));
      console.log(`[ProcessDocument] Marked document ${data.documentId} as failed`);
    } catch (dbError) {
      console.error("[ProcessDocument] Could not mark document as failed:", dbError);
    }
  }

  if (data?.jobId) {
    try {
      await db
        .update(ocrJobs)
        .set({
          status: "failed",
          errorMessage,
          completedAt: new Date(),
        })
        .where(eq(ocrJobs.id, data.jobId));
      console.log(`[ProcessDocument] Marked ocr_jobs ${data.jobId} as failed`);
    } catch (dbError) {
      console.error("[ProcessDocument] Could not mark job as failed:", dbError);
    }
  }
}