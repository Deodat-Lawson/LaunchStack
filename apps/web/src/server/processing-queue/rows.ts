/**
 * The lean reads behind the Processing queue: job rows joined to the
 * documents the caller may see (ADR-014), and the stage rows and outbox rows
 * for a set of jobs. Shared by the list and by Retry, so both see a job the
 * same way. `ocr_jobs.ocr_result` (every page's text) and the outbox payloads
 * are never selected.
 */

import { and, asc, desc, eq, inArray, or, sql, type SQL } from "drizzle-orm";

import { document, eventOutbox, ocrJobs, ocrProcessingSteps } from "@launchstack/store/schema";
import { scopedDocumentWhere } from "~/lib/authz/scope";
import type { DocumentScope } from "~/lib/authz/scope-types";
import {
    queueEventIds,
    type QueueDocumentRow,
    type QueueEventRow,
    type QueueJobRow,
    type QueueStepRow,
} from "~/lib/processing-queue/stages";
import { db } from "~/server/db";
import type { Executor } from "~/server/workspace/db-types";

export interface QueueJobWithDocument {
    job: QueueJobRow & { versionId: bigint | null };
    document: QueueDocumentRow;
}

const jobColumns = {
    id: ocrJobs.id,
    documentId: ocrJobs.documentId,
    versionId: ocrJobs.versionId,
    userId: ocrJobs.userId,
    status: ocrJobs.status,
    documentName: ocrJobs.documentName,
    pageCount: ocrJobs.pageCount,
    actualProvider: ocrJobs.actualProvider,
    startedAt: ocrJobs.startedAt,
    completedAt: ocrJobs.completedAt,
    errorMessage: ocrJobs.errorMessage,
    createdAt: ocrJobs.createdAt,
    updatedAt: ocrJobs.updatedAt,
    docId: document.id,
    docTitle: document.title,
    docCategory: document.category,
    docMimeType: document.mimeType,
};

/**
 * Jobs whose document the caller can see, joined to it. Jobs whose document
 * was deleted (`document_id` set null) never match the join.
 */
async function selectVisibleJobs(
    companyId: bigint,
    scope: DocumentScope,
    where: SQL | undefined,
    opts: { limit: number; executor?: Executor }
): Promise<QueueJobWithDocument[]> {
    const executor = opts.executor ?? db;
    const rows = await executor
        .select(jobColumns)
        .from(ocrJobs)
        .innerJoin(document, eq(ocrJobs.documentId, document.id))
        .where(and(eq(ocrJobs.companyId, companyId), scopedDocumentWhere(companyId, scope), where))
        .orderBy(desc(ocrJobs.createdAt), asc(ocrJobs.id))
        .limit(opts.limit);
    return rows.map(row => ({
        job: {
            id: row.id,
            documentId: row.documentId,
            versionId: row.versionId,
            userId: row.userId,
            status: row.status,
            documentName: row.documentName,
            pageCount: row.pageCount,
            actualProvider: row.actualProvider,
            startedAt: row.startedAt,
            completedAt: row.completedAt,
            errorMessage: row.errorMessage,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
        },
        document: {
            id: Number(row.docId),
            title: row.docTitle,
            category: row.docCategory,
            mimeType: row.docMimeType,
        },
    }));
}

/** Active jobs, plus jobs that finished (or failed) since `finishedSince`. Newest first. */
export function selectQueueJobs(
    companyId: bigint,
    scope: DocumentScope,
    finishedSince: Date,
    limit: number
): Promise<QueueJobWithDocument[]> {
    return selectVisibleJobs(
        companyId,
        scope,
        or(
            inArray(ocrJobs.status, ["queued", "processing"]),
            and(
                inArray(ocrJobs.status, ["completed", "failed", "needs_review"]),
                // A raw SQL operand gets no column encoder, so the bound
                // value must already be a string (postgres-js can't take a Date here).
                sql`coalesce(${ocrJobs.completedAt}, ${ocrJobs.updatedAt}, ${ocrJobs.createdAt}) >= ${finishedSince.toISOString()}::timestamptz`
            )
        ),
        { limit }
    );
}

/** One job, when the caller can see its document. */
export async function selectVisibleJob(
    companyId: bigint,
    scope: DocumentScope,
    jobId: string,
    executor?: Executor
): Promise<QueueJobWithDocument | null> {
    const [row] = await selectVisibleJobs(companyId, scope, eq(ocrJobs.id, jobId), {
        limit: 1,
        executor,
    });
    return row ?? null;
}

/** Stage rows for these jobs, grouped by job id. */
export async function selectSteps(
    jobIds: readonly string[],
    executor: Executor = db
): Promise<Map<string, QueueStepRow[]>> {
    const out = new Map<string, QueueStepRow[]>();
    if (jobIds.length === 0) return out;
    const rows = await executor
        .select({
            jobId: ocrProcessingSteps.jobId,
            stepType: ocrProcessingSteps.stepType,
            status: ocrProcessingSteps.status,
            output: ocrProcessingSteps.output,
            errorMessage: ocrProcessingSteps.errorMessage,
            durationMs: ocrProcessingSteps.durationMs,
            createdAt: ocrProcessingSteps.createdAt,
        })
        .from(ocrProcessingSteps)
        .where(inArray(ocrProcessingSteps.jobId, [...jobIds]));
    for (const { jobId, ...step } of rows) {
        const list = out.get(jobId);
        if (list) list.push(step);
        else out.set(jobId, [step]);
    }
    return out;
}

/** The extraction and indexing outbox rows for these jobs, grouped by job id. */
export async function selectEvents(
    companyId: bigint,
    jobIds: readonly string[],
    executor: Executor = db
): Promise<Map<string, QueueEventRow[]>> {
    const out = new Map<string, QueueEventRow[]>();
    if (jobIds.length === 0) return out;
    const jobByEventId = new Map<string, string>();
    for (const jobId of jobIds) {
        const ids = queueEventIds(jobId);
        jobByEventId.set(ids.extraction, jobId);
        jobByEventId.set(ids.indexing, jobId);
    }
    const rows = await executor
        .select({
            eventId: eventOutbox.eventId,
            status: eventOutbox.status,
            attemptCount: eventOutbox.attemptCount,
            availableAt: eventOutbox.availableAt,
            claimedAt: eventOutbox.claimedAt,
            processedAt: eventOutbox.processedAt,
            lastError: eventOutbox.lastError,
        })
        .from(eventOutbox)
        .where(
            and(
                eq(eventOutbox.companyId, Number(companyId)),
                inArray(eventOutbox.eventId, [...jobByEventId.keys()])
            )
        );
    for (const row of rows) {
        const jobId = jobByEventId.get(row.eventId);
        if (!jobId) continue;
        const list = out.get(jobId);
        if (list) list.push(row);
        else out.set(jobId, [row]);
    }
    return out;
}
