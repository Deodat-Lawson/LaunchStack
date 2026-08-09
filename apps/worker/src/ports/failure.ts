/**
 * Failure visibility (ADR-003): when a pipeline event dies after max
 * attempts, mark the underlying OCR job failed so the product UI shows the
 * terminal state instead of an eternal "processing".
 */
import { and, eq, inArray } from "drizzle-orm";

import type { ClaimedEvent, LoggerPort } from "@launchstack/application";
import { getDb } from "@launchstack/core/db";
import { ocrJobs } from "@launchstack/core/db/schema";

const JOB_BEARING_EVENTS = new Set([
  "source.version.created",
  "evidence.version.extracted",
  "evidence.version.indexed",
]);

export function createDeadEventHandler(logger: LoggerPort) {
  return async (claimed: ClaimedEvent, error: string): Promise<void> => {
    const { event } = claimed;
    if (!JOB_BEARING_EVENTS.has(event.eventType)) return;
    const payload = event.payload as { ocrJobId?: string };
    if (!payload.ocrJobId) return;

    const db = getDb();
    await db
      .update(ocrJobs)
      .set({
        status: "failed",
        errorMessage: `pipeline dead after max attempts: ${error}`.slice(0, 2000),
      })
      .where(
        and(
          eq(ocrJobs.id, payload.ocrJobId),
          // Never clobber a terminal success written by a competing replay.
          inArray(ocrJobs.status, ["queued", "processing", "failed"]),
        ),
      );
    logger.error(
      {
        traceId: event.traceId,
        ocrJobId: payload.ocrJobId,
        eventType: event.eventType,
      },
      "marked OCR job failed after pipeline exhausted retries",
    );
  };
}
