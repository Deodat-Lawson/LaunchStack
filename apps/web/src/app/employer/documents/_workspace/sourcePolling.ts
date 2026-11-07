/**
 * How often the source list re-asks the server while something is still
 * processing. Each refresh is three requests (documents, folders, maps), so a
 * flat 3s poll was 300 requests per 15 minutes per endpoint — the whole read
 * budget, forever, for a document stuck in processing.
 *
 * Instead: start at 3s so a quick upload still feels live, slow down by half
 * again each time up to 30s, and stop after about half an hour of watching
 * the same sources go nowhere. A change to what is processing (one finished,
 * another started) starts the schedule over; returning to the tab polls once.
 *
 * "Go nowhere" is measured from the last time the worker reported movement —
 * a new stage, another embedding batch, a retry scheduled. A 300-page book
 * that takes an hour keeps its bar moving at the 30s pace; a source the
 * worker has stopped talking about still stops being asked about.
 */
export const SOURCE_POLL = {
    initialMs: 3_000,
    factor: 1.5,
    maxMs: 30_000,
    /** Visible polling time after which the same processing sources stop being polled. */
    giveUpAfterMs: 30 * 60_000,
} as const;

/** The wait before poll number `tick` (0-based). */
export function sourcePollDelay(tick: number): number {
    return Math.min(
        Math.round(SOURCE_POLL.initialMs * SOURCE_POLL.factor ** tick),
        SOURCE_POLL.maxMs
    );
}

/**
 * The wait before poll number `tick`, or null once the polls since anything
 * last moved have spent the give-up budget — the source is stuck, and asking
 * every 30s for the rest of the day only burns the rate limit.
 *
 * `quietTicks` is how many of the polls so far saw no progress; it defaults
 * to all of them. The pace never speeds back up — only the budget refills.
 */
export function nextSourcePollDelay(tick: number, quietTicks: number = tick): number | null {
    let waited = 0;
    for (let i = Math.max(0, tick - quietTicks); i < tick; i++) waited += sourcePollDelay(i);
    const delay = sourcePollDelay(tick);
    return waited + delay > SOURCE_POLL.giveUpAfterMs ? null : delay;
}

/** Enough of a processing source's report to tell whether the worker moved it. */
interface ReportedProcessing {
    id: number;
    processing?: {
        status: string;
        progress: { stage: string; done?: number } | null;
        retry: { attempt: number; nextAttemptAt: string } | null;
    } | null;
}

/**
 * What the worker has said about the sources in flight, as one comparable
 * string — a different value from the last poll means something moved — and
 * the latest moment a scheduled retry is due, until which waiting is not
 * "stuck".
 */
export function processingActivity(docs: readonly ReportedProcessing[]): {
    signature: string;
    retryDueAt: number;
} {
    let retryDueAt = 0;
    const parts: string[] = [];
    for (const doc of docs) {
        const p = doc.processing;
        if (!p) continue;
        parts.push(
            [doc.id, p.status, p.progress?.stage, p.progress?.done, p.retry?.attempt].join(":")
        );
        if (p.retry) retryDueAt = Math.max(retryDueAt, Date.parse(p.retry.nextAttemptAt) || 0);
    }
    return { signature: parts.join("|"), retryDueAt };
}
