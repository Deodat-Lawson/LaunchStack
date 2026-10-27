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
    /** A short fact about the stage: "Docling", "12 pages", "attempt 2". */
    detail?: string;
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

export interface QueueItemError {
    /** One plain sentence for people ("Couldn't read the file from storage."). */
    message: string;
    /** The raw error, for "Copy details". Null when there is none. */
    detail: string | null;
}

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
    error: QueueItemError | null;
    pageCount: number | null;
    /** Who read the text ("Docling", "Native PDF", "Azure"), when known. */
    provider: string | null;
    createdAt: string;
    startedAt: string | null;
    completedAt: string | null;
    /** Whether the viewer may press Retry (state `failed` and edit access). */
    canRetry: boolean;
    /**
     * `recorded` when the worker wrote per-stage rows (ocr_processing_steps);
     * `inferred` when the stages were worked out from the job and its outbox
     * events (a worker that predates stage recording).
     */
    stageSource: "recorded" | "inferred";
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

export interface ProcessingRetryResponse {
    ok: true;
    item: ProcessingQueueItem;
}
