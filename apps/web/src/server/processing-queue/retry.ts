/**
 * Retry a failed ingestion job from the Processing queue.
 *
 * The same revive a re-upload performs (`dispatchInTx` in
 * @launchstack/orchestration's source lifecycle), aimed at the half that
 * died: the job goes back to `queued`, and the dead outbox event gets a fresh
 * attempt budget — `evidence.version.extracted` when extraction had finished,
 * `source.version.created` otherwise. Extraction is not re-run for a file that
 * only failed to index; a revived extraction re-enqueues indexing itself when
 * it completes (the outbox's revive-on-enqueue).
 *
 * In one transaction with the job row locked, so a double click retries once
 * and a worker cannot interleave: the job, the event, the stage rows of the
 * half being re-run, and the "failed" marker the sidebar reads from the
 * document and version metadata (written by apps/worker's failure port).
 */

import { and, eq, inArray, sql, type AnyColumn } from "drizzle-orm";

import {
    document,
    documentVersions,
    eventOutbox,
    ocrJobs,
    ocrProcessingSteps,
} from "@launchstack/store/schema";
import { queueEventIds, stepTypesFrom } from "~/lib/processing-queue/stages";
import type { ProcessingQueueItem, QueueStageId } from "~/lib/processing-queue/types";
import { db } from "~/server/db";
import { DOCUMENT_EDIT_DENIED } from "~/server/services/folder-access";
import { canEditDocument } from "~/server/workspace/item-access";

import { buildItems, type QueueActor } from "./list";
import { selectVisibleJob } from "./rows";

export type RetryResult =
    | { ok: true; item: ProcessingQueueItem }
    | { ok: false; status: 403 | 404 | 409; error: string };

export const RETRY_NOT_FOUND = "That file isn't in your processing queue.";
export const RETRY_NEEDS_UPLOAD = "Retrying takes permission to add files.";
export const RETRY_NOT_FAILED = "Only a file whose processing failed can be retried.";
export const RETRY_NOTHING_TO_REVIVE =
    "There's no failed processing step to restart for this file — upload it again instead.";

/** The failure keys apps/worker/src/ports/failure.ts stamps on document and version metadata. */
const FAILURE_KEYS = sql`'error' - 'errorMessage' - 'failedAt'`;

class RetryConflict extends Error {}

export async function retryProcessingJob(actor: QueueActor, jobId: string): Promise<RetryResult> {
    if (!actor.can("documents.upload")) {
        return { ok: false, status: 403, error: RETRY_NEEDS_UPLOAD };
    }

    const scope = await actor.documentScope();
    const visible = await selectVisibleJob(actor.companyId, scope, jobId);
    if (!visible) return { ok: false, status: 404, error: RETRY_NOT_FOUND };

    const { job, document: doc } = visible;
    if (!(await canEditDocument(actor, { id: doc.id, category: doc.category }))) {
        return { ok: false, status: 403, error: DOCUMENT_EDIT_DENIED };
    }
    if (job.status !== "failed") return { ok: false, status: 409, error: RETRY_NOT_FAILED };

    const ids = queueEventIds(job.id);
    try {
        await db.transaction(async tx => {
            const [locked] = await tx
                .select({ status: ocrJobs.status })
                .from(ocrJobs)
                .where(and(eq(ocrJobs.id, job.id), eq(ocrJobs.companyId, actor.companyId)))
                .for("update");
            if (locked?.status !== "failed") throw new RetryConflict(RETRY_NOT_FAILED);

            const events = await tx
                .select({ eventId: eventOutbox.eventId, status: eventOutbox.status })
                .from(eventOutbox)
                .where(
                    and(
                        eq(eventOutbox.companyId, Number(actor.companyId)),
                        inArray(eventOutbox.eventId, [ids.extraction, ids.indexing])
                    )
                )
                .for("update");
            const extraction = events.find(e => e.eventId === ids.extraction);
            const indexing = events.find(e => e.eventId === ids.indexing);

            let revive: { eventId: string; from: QueueStageId } | null = null;
            if (extraction?.status === "processed" && indexing?.status === "dead") {
                revive = { eventId: indexing.eventId, from: "splitting" };
            } else if (extraction?.status === "dead") {
                revive = { eventId: extraction.eventId, from: "reading" };
            }
            if (!revive) throw new RetryConflict(RETRY_NOTHING_TO_REVIVE);

            await tx
                .update(ocrJobs)
                .set({
                    status: "queued",
                    errorMessage: null,
                    startedAt: null,
                    completedAt: null,
                    retryCount: sql`coalesce(${ocrJobs.retryCount}, 0) + 1`,
                    updatedAt: new Date(),
                })
                .where(eq(ocrJobs.id, job.id));

            await tx
                .update(eventOutbox)
                .set({
                    status: "pending",
                    attemptCount: 0,
                    availableAt: sql`CURRENT_TIMESTAMP`,
                    claimedAt: null,
                    processedAt: null,
                    lastError: null,
                    updatedAt: new Date(),
                })
                .where(
                    and(eq(eventOutbox.eventId, revive.eventId), eq(eventOutbox.status, "dead"))
                );

            // The handler re-runs its whole half, so its stage rows start over.
            await tx
                .delete(ocrProcessingSteps)
                .where(
                    and(
                        eq(ocrProcessingSteps.jobId, job.id),
                        inArray(ocrProcessingSteps.stepType, stepTypesFrom(revive.from))
                    )
                );

            // Clear the failure marker the same way it was written: on the
            // job's version, and on the document only while that version is
            // current (or the job predates versions).
            const failedMarker = (column: AnyColumn) =>
                sql`${column} ->> 'error' = 'processing_failed'`;
            await tx
                .update(document)
                .set({
                    ocrMetadata: sql`nullif(${document.ocrMetadata} - ${FAILURE_KEYS}, '{}'::jsonb)`,
                })
                .where(
                    and(
                        eq(document.id, doc.id),
                        failedMarker(document.ocrMetadata),
                        job.versionId === null
                            ? undefined
                            : eq(document.currentVersionId, job.versionId)
                    )
                );
            if (job.versionId !== null) {
                await tx
                    .update(documentVersions)
                    .set({
                        ocrMetadata: sql`nullif(${documentVersions.ocrMetadata} - ${FAILURE_KEYS}, '{}'::jsonb)`,
                    })
                    .where(
                        and(
                            eq(documentVersions.id, Number(job.versionId)),
                            eq(documentVersions.documentId, BigInt(doc.id)),
                            failedMarker(documentVersions.ocrMetadata)
                        )
                    );
            }
        });
    } catch (error) {
        if (error instanceof RetryConflict) return { ok: false, status: 409, error: error.message };
        throw error;
    }

    const fresh = await selectVisibleJob(actor.companyId, scope, job.id);
    if (!fresh) return { ok: false, status: 404, error: RETRY_NOT_FOUND };
    const [item] = await buildItems(actor, [fresh], new Date(), new Set());
    return { ok: true, item: item! };
}
