/**
 * Turns the raw error a pipeline stage left behind into one sentence a person
 * can act on, keeping the raw text for "Copy details".
 *
 * The raw strings come from three writers:
 *
 * - `ocr_jobs.error_message`, stamped by the worker when an event dies —
 *   `pipeline event dead: <error>` (apps/worker/src/ports/failure.ts), or
 *   `pipeline dead after max attempts: <error>` on rows from older workers;
 * - `event_outbox.last_error`, the latest attempt's error while the worker is
 *   still retrying;
 * - `ocr_processing_steps.error_message`, the failed stage's own error.
 *
 * All three render an error with its `cause` chain joined by
 * " ← caused by: " (`describeError` in @launchstack/orchestration).
 */

import type { QueueItemError } from "./types";

const DEAD_PREFIX = /^\s*pipeline (?:dead after max attempts|event dead)\s*:\s*/i;

/** The raw error without the worker's dead-letter prefixes, cause chain kept. */
function withoutPrefixes(raw: string): string {
    let text = raw;
    // A replayed job can carry the prefix twice ("pipeline event dead: pipeline dead …").
    while (DEAD_PREFIX.test(text)) text = text.replace(DEAD_PREFIX, "");
    return text.trim();
}

interface Rule {
    readonly test: RegExp;
    readonly message: string;
}

/**
 * First match wins, tested against the whole chain (prefixes stripped), so a
 * cause deep in the chain still names the failure. Order matters: the
 * subsystem that failed (storage, converter) is more useful than the
 * transport symptom (fetch failed, timeout) it failed with.
 */
const RULES: readonly Rule[] = [
    {
        // "[s3] fetch failed", "[database] …", missing objects.
        test: /\[(?:s3|database|storage|blob|seaweedfs)\]|nosuchkey|no such key|object not found in storage|storage (?:read|fetch|download)/i,
        message: "Couldn't fetch the file from storage.",
    },
    {
        test: /\b402\b|\b429\b|insufficient (?:credit|funds|balance)|out of credit|quota|rate[\s-]?limit|too many requests|billing/i,
        message: "The AI provider is out of credit or rate-limited — try again later.",
    },
    {
        // "Document converter /convert failed: 400 Bad Request — {…}"
        test: /document converter [^\n]*?failed:\s*4\d\d\b/i,
        message: "The converter couldn't open this file.",
    },
    {
        test: /document converter [^\n]*?failed:\s*5\d\d\b/i,
        message: "The document converter had a problem — try again later.",
    },
    {
        test: /timed out|timeout|etimedout|deadline exceeded/i,
        message: "Processing took too long and timed out.",
    },
    {
        test: /unsupported (?:file|mime|media|content|document)|not a supported|file type (?:is )?not supported|cannot (?:read|process) files of type/i,
        message: "This file type isn't supported.",
    },
    {
        test: /embedding|embed(?:ding)? index|vectori[sz]/i,
        message: "Couldn't build the search index for this file.",
    },
    {
        test: /reclaimed after stale claim/i,
        message: "The worker kept stopping while processing this file.",
    },
    {
        test: /document converter|econnrefused|enotfound|econnreset|socket hang up|fetch failed/i,
        message: "Couldn't reach a service needed to process this file.",
    },
];

export const GENERIC_PROCESSING_ERROR = "Processing stopped with an error.";

/** One plain sentence for people plus the raw error, or null when there is none. */
export function friendlyProcessingError(raw: string | null | undefined): QueueItemError | null {
    if (raw == null) return null;
    const detail = raw.trim();
    if (detail.length === 0) return null;
    const chain = withoutPrefixes(detail);
    const rule = RULES.find(r => r.test.test(chain));
    return { message: rule?.message ?? GENERIC_PROCESSING_ERROR, detail };
}
