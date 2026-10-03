/**
 * How often the source list re-asks the server while something is still
 * processing. Each refresh is three requests (documents, folders, maps), so a
 * flat 3s poll was 300 requests per 15 minutes per endpoint — the whole read
 * budget, forever, for a document stuck in processing.
 *
 * Instead: start at 3s so a quick upload still feels live, slow down by half
 * again each time up to 30s, and stop after about half an hour of watching
 * the same sources. A change to what is processing (one finished, another
 * started) starts the schedule over; returning to the tab polls once.
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
 * The wait before poll number `tick`, or null once the polls so far have
 * spent the give-up budget — the source is stuck, and asking every 30s for
 * the rest of the day only burns the rate limit.
 */
export function nextSourcePollDelay(tick: number): number | null {
    let waited = 0;
    for (let i = 0; i < tick; i++) waited += sourcePollDelay(i);
    const delay = sourcePollDelay(tick);
    return waited + delay > SOURCE_POLL.giveUpAfterMs ? null : delay;
}
