/**
 * The Usage tab's time window: a preset number of days ending today, or a
 * custom `from`–`to`, in UTC calendar days (the days `ai_usage_daily` keeps).
 * The route reads it from the query and the tab writes it there, so a copied
 * link opens the same window.
 */

import type { UsageWindow } from "./types";

/** The presets the tab offers, in its order. */
export const USAGE_PRESETS = [7, 30, 90] as const;
export type UsagePreset = (typeof USAGE_PRESETS)[number];

export const DEFAULT_USAGE_DAYS: UsagePreset = 30;
/** The longest window a custom range may span. */
export const MAX_USAGE_DAYS = 366;

const DAY_MS = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isoDay(at: Date): string {
    return at.toISOString().slice(0, 10);
}

function parseDay(value: string): number | null {
    if (!ISO_DATE.test(value)) return null;
    const time = Date.parse(`${value}T00:00:00Z`);
    // `Date.parse` rolls 2026-02-31 over to March; refuse what doesn't round-trip.
    return Number.isNaN(time) || isoDay(new Date(time)) !== value ? null : time;
}

function windowOf(fromMs: number, toMs: number): UsageWindow {
    const days = Math.round((toMs - fromMs) / DAY_MS) + 1;
    return {
        from: isoDay(new Date(fromMs)),
        to: isoDay(new Date(toMs)),
        days,
        previousFrom: isoDay(new Date(fromMs - days * DAY_MS)),
        previousTo: isoDay(new Date(fromMs - DAY_MS)),
    };
}

/** The last `days` days, today included. */
export function presetWindow(days: number, now: Date = new Date()): UsageWindow {
    const today = Date.parse(`${isoDay(now)}T00:00:00Z`);
    return windowOf(today - (days - 1) * DAY_MS, today);
}

export type UsageWindowResult = { ok: true; window: UsageWindow } | { ok: false; error: string };

/**
 * The window a query names: `from` and `to` together, or `days` (1 to
 * {@link MAX_USAGE_DAYS}), or the default 30 days. A day after today is
 * refused, as is a range that runs backwards or past the longest span.
 */
export function parseUsageWindow(
    params: URLSearchParams,
    now: Date = new Date()
): UsageWindowResult {
    const from = params.get("from");
    const to = params.get("to");
    if (from !== null || to !== null) {
        const fromMs = from === null ? null : parseDay(from);
        const toMs = to === null ? null : parseDay(to);
        if (fromMs === null || toMs === null) {
            return { ok: false, error: "from and to must both be dates (YYYY-MM-DD)" };
        }
        const today = Date.parse(`${isoDay(now)}T00:00:00Z`);
        if (toMs > today) return { ok: false, error: "to can't be after today" };
        if (fromMs > toMs) return { ok: false, error: "from must be on or before to" };
        if ((toMs - fromMs) / DAY_MS + 1 > MAX_USAGE_DAYS) {
            return { ok: false, error: `a range can span at most ${MAX_USAGE_DAYS} days` };
        }
        return { ok: true, window: windowOf(fromMs, toMs) };
    }
    const raw = params.get("days");
    if (raw === null || raw === "") {
        return { ok: true, window: presetWindow(DEFAULT_USAGE_DAYS, now) };
    }
    const days = Number(raw);
    if (!Number.isInteger(days) || days < 1 || days > MAX_USAGE_DAYS) {
        return { ok: false, error: `days must be a whole number from 1 to ${MAX_USAGE_DAYS}` };
    }
    return { ok: true, window: presetWindow(days, now) };
}

/** Every day of a window, oldest first. */
export function windowDays(window: Pick<UsageWindow, "from" | "to">): string[] {
    const out: string[] = [];
    const end = Date.parse(`${window.to}T00:00:00Z`);
    for (let at = Date.parse(`${window.from}T00:00:00Z`); at <= end; at += DAY_MS) {
        out.push(isoDay(new Date(at)));
    }
    return out;
}
