/**
 * Where one ingestion job is, as the Processing queue tab draws it — worked
 * out from database rows by pure functions, so every rule here is unit-tested
 * without a database.
 *
 * Three sources of truth, in the order they are trusted:
 *
 * 1. **The job** (`ocr_jobs.status`). `completed` means searchable, `failed`
 *    means out of attempts; nothing below overrides those.
 * 2. **The job's outbox events.** `source.version.created:<job>` runs the
 *    extraction (the `reading` stage) and, once processed, enqueues
 *    `evidence.version.extracted:<job>`, which runs chunking, embedding and
 *    finalising (`splitting`, `indexing`, `ready`). Which event is live says
 *    which half of the trip the job is in; a pending event with failed
 *    attempts behind it is `retrying` — the job row stays `processing` with
 *    no error while that happens.
 * 3. **The progress the stages record** (`ocr_jobs.progress`: reading,
 *    chunking, embedding with done/total, finishing — the same column the
 *    Sources rail draws). It says which stage inside the live half is
 *    running. A record older than the live attempt's claim is from an earlier
 *    attempt and is not trusted.
 */

import type { OcrJobProgress } from "@launchstack/store/schema";
import { normalizeFolderPath, UNFILED_FOLDER } from "~/lib/folders/path";

import {
    QUEUE_STAGE_IDS,
    type ProcessingQueueItem,
    type ProcessingQueueSummary,
    type QueueItemState,
    type QueueStage,
    type QueueStageId,
} from "./types";

// ---------------------------------------------------------------------------
// Input rows (the columns the service selects)
// ---------------------------------------------------------------------------

export interface QueueJobRow {
    id: string;
    documentId: number | bigint | null;
    versionId: number | bigint | null;
    userId: string;
    /** queued | processing | completed | failed | needs_review */
    status: string;
    documentName: string;
    pageCount: number | null;
    actualProvider: string | null;
    progress: OcrJobProgress | null;
    retryCount: number | null;
    startedAt: Date | null;
    completedAt: Date | null;
    errorMessage: string | null;
    createdAt: Date;
    updatedAt: Date | null;
}

export interface QueueDocumentRow {
    id: number;
    title: string;
    category: string | null;
    mimeType: string | null;
    currentVersionId: number | bigint | null;
}

export interface QueueEventRow {
    eventId: string;
    /** pending | processing | processed | dead */
    status: string;
    /** Failed attempts so far (a reclaimed stale claim counts as one). */
    attemptCount: number;
    /** Not-before time of the next claim. */
    availableAt: Date | null;
    /** When the current (or last) attempt was claimed; null after a failure reschedules it. */
    claimedAt: Date | null;
    processedAt: Date | null;
    lastError: string | null;
}

export interface BuildQueueItemInput {
    job: QueueJobRow;
    document: QueueDocumentRow | null;
    events: readonly QueueEventRow[];
    /** The viewer's auth user id. */
    viewerUserId: string;
    /** Whether the viewer may edit the file (and holds documents.upload). */
    canEdit: boolean;
    /** Attempts after which an event goes dead (DEFAULT_RETRY_POLICY.maxAttempts). */
    maxAttempts: number;
    now: Date;
}

export const EXTRACTION_EVENT_TYPE = "source.version.created";
export const INDEXING_EVENT_TYPE = "evidence.version.extracted";

/** The two outbox event ids a job's trip runs on (protocol `eventIds`). */
export function queueEventIds(jobId: string): { extraction: string; indexing: string } {
    return {
        extraction: `${EXTRACTION_EVENT_TYPE}:${jobId}`,
        indexing: `${INDEXING_EVENT_TYPE}:${jobId}`,
    };
}

/** The queue stage each recorded progress stage is. */
const STAGE_OF_PROGRESS: Record<OcrJobProgress["stage"], QueueStageId> = {
    reading: "reading",
    chunking: "splitting",
    embedding: "indexing",
    finishing: "ready",
};

/** The stages the indexing half runs, in order. */
const INDEXING_STAGES: readonly QueueStageId[] = ["splitting", "indexing", "ready"];

/**
 * A worker writing progress with its own clock can land a little before the
 * outbox's `claimed_at` (the database's clock). A record older than the claim
 * by more than this belongs to an earlier attempt.
 */
const CLOCK_SKEW_MS = 5_000;

function iso(value: Date | null | undefined): string | null {
    return value ? value.toISOString() : null;
}

function isLiveHalf(event: QueueEventRow | null): event is QueueEventRow {
    return event !== null && event.status !== "processed";
}

/** The recorded stage, when the record belongs to the attempt that is running now. */
function recordedStage(
    progress: OcrJobProgress | null,
    claimedAt: Date | null
): QueueStageId | null {
    if (!progress) return null;
    const stage = STAGE_OF_PROGRESS[progress.stage];
    if (!stage) return null;
    if (claimedAt) {
        const at = Date.parse(progress.updatedAt);
        if (!Number.isFinite(at) || at < claimedAt.getTime() - CLOCK_SKEW_MS) return null;
    }
    return stage;
}

interface Position {
    state: QueueItemState;
    stage: QueueStageId;
    /** The event of the half that is live (or gave up), when known. */
    event: QueueEventRow | null;
    /** The current stage is the failed one. */
    failed: boolean;
}

function locate(
    job: QueueJobRow,
    extraction: QueueEventRow | null,
    indexing: QueueEventRow | null
): Position {
    const status = job.status;
    if (status === "completed" || status === "needs_review") {
        return { state: "done", stage: "ready", event: null, failed: false };
    }

    if (status === "failed") {
        // The half that gave up: extraction unless it finished.
        if (extraction && extraction.status !== "processed") {
            return { state: "failed", stage: "reading", event: extraction, failed: true };
        }
        const recorded = recordedStage(job.progress, null);
        const stage =
            recorded && INDEXING_STAGES.includes(recorded)
                ? recorded
                : extraction || indexing
                  ? "indexing"
                  : "reading";
        return { state: "failed", stage, event: indexing, failed: true };
    }

    // In flight: which half is live?
    const half: { event: QueueEventRow; extraction: boolean } | null = isLiveHalf(extraction)
        ? { event: extraction, extraction: true }
        : isLiveHalf(indexing)
          ? { event: indexing, extraction: false }
          : null;

    if (!half) {
        // No outbox row to go on: trust the job and what it recorded.
        if (status === "processing") {
            return {
                state: "running",
                stage: recordedStage(job.progress, null) ?? "reading",
                event: null,
                failed: false,
            };
        }
        // Extraction done and the indexing event not written yet, or nothing yet.
        return {
            state: "waiting",
            stage: extraction?.status === "processed" ? "splitting" : "waiting",
            event: null,
            failed: false,
        };
    }

    const { event } = half;
    const firstStage: QueueStageId = half.extraction ? "reading" : "splitting";
    const recorded = recordedStage(job.progress, event.claimedAt);
    const inHalf = (stage: QueueStageId | null): stage is QueueStageId =>
        stage !== null && (half.extraction ? stage === "reading" : INDEXING_STAGES.includes(stage));

    const lastRecorded = recordedStage(job.progress, null);
    if (event.status === "dead") {
        // The job row has not caught up with its dead event yet.
        return {
            state: "failed",
            stage: inHalf(lastRecorded) ? lastRecorded : firstStage,
            event,
            failed: true,
        };
    }
    if (event.status === "processing") {
        return {
            state: "running",
            stage: inHalf(recorded) ? recorded : firstStage,
            event,
            failed: false,
        };
    }
    // Pending: waiting out a backoff after a failed attempt, or in line.
    if (event.attemptCount > 0 && event.lastError) {
        return {
            state: "retrying",
            stage: inHalf(lastRecorded) ? lastRecorded : firstStage,
            event,
            failed: false,
        };
    }
    return {
        state: "waiting",
        stage: half.extraction ? "waiting" : "splitting",
        event,
        failed: false,
    };
}

/** When each stage started and ended, from what the rows can say. */
function stageTimes(
    stage: QueueStageId,
    job: QueueJobRow,
    extraction: QueueEventRow | null,
    indexing: QueueEventRow | null
): { startedAt: Date | null; endedAt: Date | null } {
    const claimed = (event: QueueEventRow | null) =>
        event && event.status !== "pending" ? event.claimedAt : null;
    const extractionStart = claimed(extraction) ?? job.startedAt;
    switch (stage) {
        case "added":
            return { startedAt: job.createdAt, endedAt: job.createdAt };
        case "waiting": {
            // A job put back in line (Retry, a re-upload) waits from then, not
            // from when it was first added: its revived event is due now.
            const requeuedAt =
                extraction?.status === "pending" &&
                extraction.attemptCount === 0 &&
                extraction.availableAt !== null &&
                extraction.availableAt > job.createdAt
                    ? extraction.availableAt
                    : null;
            return { startedAt: requeuedAt ?? job.createdAt, endedAt: claimed(extraction) };
        }
        case "reading":
            return { startedAt: extractionStart, endedAt: extraction?.processedAt ?? null };
        case "splitting":
        case "indexing":
            return {
                startedAt: claimed(indexing),
                endedAt: stage === "indexing" ? (indexing?.processedAt ?? null) : null,
            };
        case "ready":
            return { startedAt: null, endedAt: job.completedAt };
    }
}

export function buildQueueItem(input: BuildQueueItemInput): ProcessingQueueItem {
    const { job, document, viewerUserId, maxAttempts } = input;
    const ids = queueEventIds(job.id);
    const extraction = input.events.find(e => e.eventId === ids.extraction) ?? null;
    // The indexing half is the live one only once extraction has finished —
    // an indexing row next to a re-queued extraction is from an earlier run.
    const indexingRow = input.events.find(e => e.eventId === ids.indexing) ?? null;
    const indexing = extraction === null || extraction.status === "processed" ? indexingRow : null;

    const position = locate(job, extraction, indexing);
    const at = QUEUE_STAGE_IDS.indexOf(position.stage);

    const stages: QueueStage[] = QUEUE_STAGE_IDS.map((id, i) => {
        const times = stageTimes(id, job, extraction, indexing);
        let status: QueueStage["status"];
        if (position.state === "done" || i < at) status = "done";
        else if (i === at) {
            // Waiting between halves: the next stage has not started yet.
            if (position.failed) status = "failed";
            else if (position.state === "waiting" && id !== "waiting") status = "pending";
            else status = "active";
        } else status = "pending";
        const stage: QueueStage = {
            id,
            status,
            startedAt: status === "pending" ? null : iso(times.startedAt),
            endedAt: status === "done" || status === "failed" ? iso(times.endedAt) : null,
        };
        if (id === "indexing" && job.progress?.stage === "embedding" && status !== "pending") {
            if (typeof job.progress.total === "number" && job.progress.total > 0) {
                stage.total = job.progress.total;
                stage.done = Math.min(job.progress.done ?? 0, job.progress.total);
            }
        }
        return stage;
    });

    // Attempts at the live (or dead) half. A running event has failed
    // `attemptCount` times before this one; a pending or dead one has failed
    // every attempt it made.
    const event = position.event;
    const made =
        position.state === "waiting"
            ? 0
            : position.state === "running"
              ? (event?.attemptCount ?? 0) + 1
              : position.state === "done"
                ? 1
                : Math.max(1, event?.attemptCount ?? 1);
    const attempt = Math.min(made, maxAttempts);

    const error =
        position.state === "failed"
            ? (job.errorMessage ?? event?.lastError ?? null)
            : position.state === "retrying"
              ? (event?.lastError ?? null)
              : null;

    const folder = normalizeFolderPath(document?.category);
    const finished = position.state === "done" || position.state === "failed";
    const isCurrentVersion =
        document?.currentVersionId == null ||
        job.versionId == null ||
        BigInt(document.currentVersionId) === BigInt(job.versionId);

    return {
        jobId: job.id,
        documentId: job.documentId == null ? null : Number(job.documentId),
        name: document?.title ?? job.documentName,
        folder: folder === UNFILED_FOLDER ? "" : folder,
        mimeType: document?.mimeType ?? null,
        addedById: job.userId,
        mine: job.userId === viewerUserId,
        state: position.state,
        stage: position.stage,
        stages,
        attempt,
        maxAttempts,
        nextAttemptAt: position.state === "retrying" ? iso(event?.availableAt) : null,
        error,
        pageCount: job.pageCount ?? job.progress?.pages ?? null,
        provider: job.actualProvider ?? null,
        retryCount: job.retryCount ?? 0,
        createdAt: job.createdAt.toISOString(),
        startedAt: iso(
            job.startedAt ?? (extraction?.status !== "pending" ? extraction?.claimedAt : null)
        ),
        completedAt: finished
            ? iso(job.completedAt ?? (position.state === "done" ? job.updatedAt : null))
            : null,
        canRetry:
            position.state === "failed" &&
            input.canEdit &&
            isCurrentVersion &&
            job.documentId != null,
    };
}

export function summarize(items: readonly ProcessingQueueItem[]): ProcessingQueueSummary {
    const summary: ProcessingQueueSummary = {
        running: 0,
        waiting: 0,
        retrying: 0,
        failed: 0,
        done: 0,
    };
    for (const item of items) summary[item.state] += 1;
    return summary;
}
