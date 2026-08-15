/**
 * Failure visibility (ADR-003): when a pipeline event dies after max
 * attempts, mark the underlying OCR job failed AND stamp the document's
 * failure metadata so the product UI shows the terminal state instead of
 * an eternal "processing". Parity with the retired Inngest
 * `handleProcessDocumentFailure`, which wrote both records.
 */
import { and, eq, inArray } from "drizzle-orm";

import type { ClaimedEvent, LoggerPort } from "@launchstack/application";
import { getDb } from "@launchstack/core/db";
import { document, ocrJobs } from "@launchstack/core/db/schema";

const JOB_BEARING_EVENTS = new Set([
    "source.version.created",
    "evidence.version.extracted",
    "evidence.version.indexed",
]);

export function createDeadEventHandler(logger: LoggerPort) {
    return async (claimed: ClaimedEvent, error: string): Promise<void> => {
        const { event } = claimed;
        if (!JOB_BEARING_EVENTS.has(event.eventType)) return;
        const payload = event.payload as {
            ocrJobId?: string;
            sourceId?: number;
            sourceVersionId?: number;
        };
        if (!payload.ocrJobId) return;

        const errorMessage = `pipeline dead after max attempts: ${error}`.slice(0, 2000);
        const db = getDb();
        await db
            .update(ocrJobs)
            .set({
                status: "failed",
                errorMessage,
                completedAt: new Date(),
            })
            .where(
                and(
                    eq(ocrJobs.id, payload.ocrJobId),
                    // Never clobber a terminal success written by a competing replay.
                    inArray(ocrJobs.status, ["queued", "processing", "failed"])
                )
            );

        // Document-level failure metadata (the UI reads document.ocrMetadata to
        // render the failed state). Guarded on the current-version pointer so a
        // failure for a superseded version never marks the live one failed —
        // same guard the retired Inngest failure handler used.
        if (payload.sourceId !== undefined && payload.sourceVersionId !== undefined) {
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
                    .where(
                        and(
                            eq(document.id, payload.sourceId),
                            eq(document.currentVersionId, BigInt(payload.sourceVersionId))
                        )
                    );
            } catch (dbError) {
                logger.error(
                    {
                        traceId: event.traceId,
                        sourceId: payload.sourceId,
                        error: String(dbError),
                    },
                    "could not stamp document failure metadata"
                );
            }
        }

        logger.error(
            {
                traceId: event.traceId,
                ocrJobId: payload.ocrJobId,
                sourceId: payload.sourceId,
                eventType: event.eventType,
            },
            "marked OCR job failed after pipeline exhausted retries"
        );
    };
}

/**
 * Failure visibility for rows the outbox store dead-letters at claim time
 * because their payload fails protocol validation. Those rows never become
 * a `ClaimedEvent` (the payload cannot be parsed), so the tick-level onDead
 * hook above cannot see them; the ocrJobId is instead recovered from the
 * deterministic event id (`<eventType>:<ocrJobId>` for the job-bearing
 * events — see protocol `eventIds`). Best-effort: a non-job-bearing or
 * unparseable id only logs, matching onDead's behavior for such events.
 * Wired into DrizzleOutboxStore via its `onValidationDead` option.
 */
export function createValidationDeadHandler(logger: LoggerPort) {
    return async (outboxId: number, eventId: string): Promise<void> => {
        for (const eventType of JOB_BEARING_EVENTS) {
            const prefix = `${eventType}:`;
            if (!eventId.startsWith(prefix)) continue;
            const ocrJobId = eventId.slice(prefix.length);
            if (!ocrJobId) break;

            const db = getDb();
            await db
                .update(ocrJobs)
                .set({
                    status: "failed",
                    errorMessage:
                        `pipeline event dead: outbox payload failed protocol validation ` +
                        `(outbox row ${outboxId})`,
                    completedAt: new Date(),
                })
                .where(
                    and(
                        eq(ocrJobs.id, ocrJobId),
                        // Never clobber a terminal success written by a competing replay.
                        inArray(ocrJobs.status, ["queued", "processing", "failed"])
                    )
                );
            logger.error(
                { outboxId, eventId, ocrJobId, eventType },
                "marked OCR job failed after outbox payload failed validation"
            );
            return;
        }
        logger.error(
            { outboxId, eventId },
            "outbox payload failed validation; no job-bearing event id — nothing to mark failed"
        );
    };
}
