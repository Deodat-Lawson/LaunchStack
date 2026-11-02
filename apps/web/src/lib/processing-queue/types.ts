/**
 * The Processing queue's wire shape: what `GET /api/documents/processing-queue`
 * returns and the Processing tab draws. One item per ingestion job the viewer
 * may see (ADR-014), active or finished in the last 24 hours.
 *
 * A file's trip, as the tab shows it:
 *
 *   added → waiting → reading → splitting → indexing → ready
 *
 * `added` is the bytes reaching storage (the browser's upload, or a connector
 * fetching the file). `waiting` is the job sitting in the worker's queue.
 * `reading` is routing + OCR / text extraction, `splitting` is chunking,
 * `indexing` is embedding and storing the chunks (with a real done/total),
 * and `ready` is finalising — the file is searchable once it is done.
 */

export const QUEUE_STAGE_IDS = [
    "added",
    "waiting",
    "reading",
    "splitting",
    "indexing",
    "ready",
] as const;
export type QueueStageId = (typeof QUEUE_STAGE_IDS)[number];

export type QueueStageStatus = "pending" | "active" | "done" | "failed";

export interface QueueStage {
    id: QueueStageId;
    status: QueueStageStatus;
    /** ISO time the stage started, when known. */
    startedAt: string | null;
    /** ISO time the stage finished (done or failed), when known. */
    endedAt: string | null;
    /** Units finished so far — chunks embedded while indexing. */
    done?: number;
    /** Units in all — chunks to embed while indexing. */
    total?: number;
}

/**
 * Where the item is overall.
 * - `waiting`: queued, not picked up yet (or between stages).
 * - `running`: a stage is in progress right now.
 * - `retrying`: an attempt failed and the worker will try again at `nextAttemptAt`.
 * - `failed`: out of attempts; needs a Retry.
 * - `done`: ready to search.
 */
export type QueueItemState = "waiting" | "running" | "retrying" | "failed" | "done";

export interface ProcessingQueueItem {
    jobId: string;
    documentId: number | null;
    /** The source's name in the library. */
    name: string;
    /** The folder path it lives in ("Google Drive/Coding Circles"); "" = no folder. */
    folder: string;
    mimeType: string | null;
    /** The auth user id of whoever added it (resolve the name client-side). */
    addedById: string;
    /** Whether the viewer added it. */
    mine: boolean;
    state: QueueItemState;
    /** The stage the item is in now (the failed one, when failed). */
    stage: QueueStageId;
    /** Always all six stages, in order. */
    stages: QueueStage[];
    /** Attempts made at the current stage (1-based once started; 0 = not started). */
    attempt: number;
    maxAttempts: number;
    /** When the worker tries again (state `retrying`). */
    nextAttemptAt: string | null;
    /**
     * The raw error — of the attempt that will be retried, or the one that
     * gave up. The client words it (`describeSourceFailure`) and keeps the raw
     * text behind "Copy details".
     */
    error: string | null;
    pageCount: number | null;
    /** The reader's code ("DOCLING", "NATIVE_PDF", "AZURE"), when known. */
    provider: string | null;
    /** Times someone pressed Retry on this job. */
    retryCount: number;
    createdAt: string;
    startedAt: string | null;
    completedAt: string | null;
    /**
     * Whether the viewer may press Retry: the job failed, it is the file's
     * current version (Retry runs `POST /api/documents/[id]/retry`, which
     * restarts the current version), and the viewer may edit the file.
     */
    canRetry: boolean;
}

export type ConnectorSyncProvider = "google-drive" | "gmail";

/** A connector sync the viewer can see that is running or finished recently. */
export interface ConnectorSyncSummary {
    provider: ConnectorSyncProvider;
    /** The connected account, when known. */
    account: string | null;
    status: "running" | "ok" | "error";
    /** ISO time of the last finished run (or the current run's start, when running). */
    lastSyncAt: string | null;
    /** Counts from the last finished run. "stored" = files queued for processing. */
    report: {
        discovered: number;
        stored: number;
        unchanged: number;
        skipped: number;
        failed: number;
    } | null;
    error: string | null;
}

export interface ProcessingQueueSummary {
    running: number;
    waiting: number;
    retrying: number;
    failed: number;
    done: number;
}

export interface ProcessingQueueResponse {
    items: ProcessingQueueItem[];
    connectors: ConnectorSyncSummary[];
    summary: ProcessingQueueSummary;
    /** The server's clock, so relative times don't drift with the browser's. */
    serverTime: string;
}
