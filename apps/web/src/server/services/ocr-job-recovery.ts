import { db } from "~/server/db";
import { ocrJobs, document } from "@launchstack/core/db/schema";
import { triggerDocumentProcessing } from "@launchstack/core/ocr/trigger";
import { getEngine } from "~/server/engine";
import { eq } from "drizzle-orm";

export interface SweepOptions {
  olderThanMs?: number;
  maxRetries?: number;
}

/**
 * One-off sweep that attempts to re-dispatch queued OCR jobs which have
 * not been processed. On dispatch failure the job's `retryCount` is
 * incremented; when it exceeds `maxRetries` the job is marked `failed`.
 */
export async function sweepQueuedOcrJobs(opts: SweepOptions = {}): Promise<void> {
  getEngine();

  const olderThanMs = opts.olderThanMs ?? 30_000; // not currently used, placeholder
  const maxRetries = opts.maxRetries ?? 3;

  // Fetch queued jobs (caller can mock `db.select` in tests)
  const jobs = await db
    .select({
      id: ocrJobs.id,
      documentId: ocrJobs.documentId,
      companyId: ocrJobs.companyId,
      userId: ocrJobs.userId,
      documentUrl: ocrJobs.documentUrl,
      documentName: ocrJobs.documentName,
      retryCount: ocrJobs.retryCount,
      createdAt: ocrJobs.createdAt,
    })
    .from(ocrJobs)
    .where(eq(ocrJobs.status, "queued"));

  for (const job of jobs as any[]) {
    const currentRetries = (job.retryCount as number) ?? 0;
    if (currentRetries >= maxRetries) {
      await db.update(ocrJobs).set({ status: "failed" }).where(eq(ocrJobs.id, job.id));
      continue;
    }

    // Resolve missing metadata (category) from documents table when possible.
    let category: string | undefined = undefined;
    if (job.documentId) {
      const [doc] = await db.select({ category: document.category }).from(document).where(eq(document.id, job.documentId));
      category = doc?.category;
    }

    try {
      await triggerDocumentProcessing(
        job.documentUrl,
        job.documentName,
        String(job.companyId),
        job.userId,
        Number(job.documentId),
        category ?? "general",
        undefined,
        job.id,
      );

      // On success, ensure retryCount is at least recorded and leave status as queued
      await db.update(ocrJobs).set({ retryCount: currentRetries }).where(eq(ocrJobs.id, job.id));
    } catch (error) {
      // Increment retry count
      await db.update(ocrJobs).set({ retryCount: currentRetries + 1 }).where(eq(ocrJobs.id, job.id));
    }
  }
}

export default sweepQueuedOcrJobs;
