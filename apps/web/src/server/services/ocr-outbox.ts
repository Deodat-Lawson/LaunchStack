import { db } from "~/server/db";
import { ocrOutbox, ocrJobs, document } from "@launchstack/core/db/schema";
import { triggerDocumentProcessing } from "@launchstack/core/ocr/trigger";
import { eq } from "drizzle-orm";

export interface OutboxSweepOptions {
  maxRetries?: number;
  batchSize?: number;
}

export async function processPendingOutbox(opts: OutboxSweepOptions = {}): Promise<void> {
  const maxRetries = opts.maxRetries ?? 5;
  const batchSize = opts.batchSize ?? 50;

  // Fetch pending outbox rows
  const rows = await db
    .select({ id: ocrOutbox.id, jobId: ocrOutbox.jobId, payload: ocrOutbox.payload, attemptCount: ocrOutbox.attemptCount })
    .from(ocrOutbox)
    .where(eq(ocrOutbox.status, "pending"));

  for (const row of rows as any[]) {
    const attempt = (row.attemptCount as number) ?? 0;
    if (attempt >= maxRetries) {
      await db.update(ocrOutbox).set({ status: "failed" }).where(eq(ocrOutbox.id, row.id));
      continue;
    }

    // Skip if the job has already been processed to avoid duplicate writes
    const [jobRow] = await db.select({ status: ocrJobs.status }).from(ocrJobs).where(eq(ocrJobs.id, row.jobId));
    if (jobRow && (jobRow.status === "processing" || jobRow.status === "completed")) {
      // mark outbox as sent to avoid retrying
      await db.update(ocrOutbox).set({ status: "sent" }).where(eq(ocrOutbox.id, row.id));
      continue;
    }

    const p = row.payload || {};

    // If the document row was deleted between enqueue and retry, skip dispatch.
    if (p.documentId !== undefined && p.documentId !== null) {
      const [docRow] = await db.select({ id: document.id }).from(document).where(eq(document.id, Number(p.documentId)));
      if (!docRow) {
        await db.update(ocrOutbox).set({ status: "failed", lastError: "document missing" }).where(eq(ocrOutbox.id, row.id));
        continue;
      }
    }
    try {
      const res = await triggerDocumentProcessing(
        p.documentUrl,
        p.documentName,
        p.companyId,
        p.userId,
        Number(p.documentId),
        p.category,
        p.options,
        row.jobId,
      );

      await db.update(ocrOutbox).set({ status: "sent", eventIds: res.eventIds as unknown }).where(eq(ocrOutbox.id, row.id));
    } catch (error: any) {
      // Exponential backoff in ms
      const backoffMs = Math.min(60_000 * Math.pow(2, attempt), 24 * 60 * 60 * 1000);
      const nextAttempt = new Date(Date.now() + backoffMs);
      await db.update(ocrOutbox).set({ attemptCount: attempt + 1, nextAttemptAt: nextAttempt, lastError: String(error?.message ?? error) }).where(eq(ocrOutbox.id, row.id));
    }
  }
}

export default processPendingOutbox;
