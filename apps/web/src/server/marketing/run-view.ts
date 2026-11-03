/**
 * The JSON a post-writer run is polled as. `events` are the progress events
 * after the caller's cursor (`after`), in order — the same events the screen
 * used to read over SSE — and `eventCount` is the next cursor.
 */
import type { MarketingPipelineResult } from "@launchstack/pipelines/marketing";
import type { MarketingRunEvent, MarketingRunRecord } from "@launchstack/pipelines/marketing/runs";

import type { Locale } from "~/i18n/locales";
import { translatorFor } from "~/i18n/translate";

const RUN_FAILURE_KEYS = ["runFailed", "runFailedChat", "runFailedCompany"] as const;
export type RunFailureKey = (typeof RUN_FAILURE_KEYS)[number];

/** A failure's stored words: English, so logs and old readers keep reading it. */
export function runFailureEnglish(key: RunFailureKey): string {
    return translatorFor("en", "growth.server.marketing")(key);
}

/** A stored failure in the reader's language; words it did not write pass through. */
function runFailureText(stored: string | null, locale: Locale): string {
    const t = translatorFor(locale, "growth.server.marketing");
    if (stored === null) return t("runFailed");
    const key = RUN_FAILURE_KEYS.find(k => runFailureEnglish(k) === stored);
    return key ? t(key) : stored;
}

export interface MarketingRunView {
    id: string;
    status: MarketingRunRecord["status"];
    input: MarketingRunRecord["input"];
    createdAt: string;
    events: MarketingRunEvent[];
    eventCount: number;
    /** Stages a retry restored from the last attempt instead of redoing. */
    resumedStages: number;
    attempts: number;
    result: MarketingPipelineResult | null;
    error: string | null;
}

export function toRunView(
    run: MarketingRunRecord,
    after = 0,
    locale: Locale = "en"
): MarketingRunView {
    const from = Math.max(0, Math.min(after, run.events.length));
    return {
        id: run.id,
        status: run.status,
        input: run.input,
        createdAt: run.createdAt.toISOString(),
        events: run.events.slice(from),
        eventCount: run.events.length,
        resumedStages: run.attempts > 1 ? Object.keys(run.checkpoints).length : 0,
        attempts: run.attempts,
        result: run.status === "completed" ? run.result : null,
        error: run.status === "failed" ? runFailureText(run.errorMessage, locale) : null,
    };
}
