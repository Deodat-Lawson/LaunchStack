import type { OcrJobProgress } from "@launchstack/store/schema";

/**
 * Where a source's processing is, as the documents list reports it for every
 * source that is not ready yet. Everything here is something the worker
 * recorded — the bar never guesses from elapsed time.
 */
export interface SourceProcessingView {
    /** The OCR job id: the trace id that follows the upload through the worker's logs. */
    jobId: string;
    status: "queued" | "processing" | "completed" | "failed" | "needs_review";
    progress: OcrJobProgress | null;
    /** Times someone pressed Retry on this job. */
    retryCount: number;
    /** Set while a stage waits out its backoff after a failed attempt. */
    retry: {
        /** The attempt that runs next, 1-based. */
        attempt: number;
        maxAttempts: number;
        /** ISO time the next attempt may start. */
        nextAttemptAt: string;
        /** Why the last attempt failed, raw — run it through describeSourceFailure. */
        lastError: string | null;
    } | null;
}

/**
 * The share of the bar each stage covers. Reading and chunking report no
 * fraction of their own, so the bar sits at the start of the stage until it
 * moves on; embedding — the long one for a big file — fills its span batch by
 * batch.
 */
const STAGE_SPAN: Record<OcrJobProgress["stage"], readonly [number, number]> = {
    reading: [5, 30],
    chunking: [30, 35],
    embedding: [35, 95],
    finishing: [95, 99],
};

export interface SourceProgressDisplay {
    /** 0–99, or null when the pipeline has said nothing measurable yet. */
    percent: number | null;
    /** A few words: "Reading pages", "Embedding 120/267". */
    label: string;
    /** When a stage is waiting to try again: why, and when. */
    waiting: { attempt: number; maxAttempts: number; at: Date; lastError: string | null } | null;
}

function stagePercent(progress: OcrJobProgress): number {
    const [start, end] = STAGE_SPAN[progress.stage];
    const { done, total } = progress;
    if (done === undefined || !total) return start;
    const fraction = Math.min(Math.max(done / total, 0), 1);
    return Math.floor(start + (end - start) * fraction);
}

function stageLabel(progress: OcrJobProgress): string {
    switch (progress.stage) {
        case "reading":
            return "Reading pages";
        case "chunking":
            return progress.pages ? `Preparing ${progress.pages} pages` : "Preparing text";
        case "embedding":
            return progress.total
                ? `Embedding ${progress.done ?? 0}/${progress.total}`
                : "Embedding";
        case "finishing":
            return "Finishing";
    }
}

/** "in 4 min", "in 30 s", "now" — from a time the outbox wrote, not an estimate. */
export function retryCountdown(at: Date, now: Date = new Date()): string {
    const seconds = Math.round((at.getTime() - now.getTime()) / 1000);
    if (seconds <= 5) return "now";
    if (seconds < 60) return `in ${seconds} s`;
    return `in ${Math.round(seconds / 60)} min`;
}

/** Turn the reported state into the bar's percent and words. */
export function describeSourceProgress(
    view: SourceProcessingView | null | undefined,
    now: Date = new Date()
): SourceProgressDisplay {
    if (!view) return { percent: null, label: "Syncing…", waiting: null };

    const progress = view.progress;
    const percent = progress ? stagePercent(progress) : view.status === "queued" ? 0 : null;

    if (view.retry) {
        const at = new Date(view.retry.nextAttemptAt);
        const waiting = {
            attempt: view.retry.attempt,
            maxAttempts: view.retry.maxAttempts,
            at,
            lastError: view.retry.lastError,
        };
        const label =
            at.getTime() > now.getTime() ? `Retrying ${retryCountdown(at, now)}` : "Retrying";
        return { percent, label, waiting };
    }

    if (progress) return { percent, label: stageLabel(progress), waiting: null };
    if (view.status === "queued") return { percent, label: "Queued", waiting: null };
    return { percent, label: "Processing", waiting: null };
}
