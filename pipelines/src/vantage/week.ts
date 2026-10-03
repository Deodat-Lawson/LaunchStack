/**
 * Week arithmetic for Vantage. Everything is an ISO date string (`YYYY-MM-DD`)
 * in the caller's local calendar; a week starts on Monday. Pure, so the
 * "which week is next" rule can be pinned by a test rather than argued about.
 */

const DAY_MS = 86_400_000;

/** `YYYY-MM-DD` for a Date, in local time. */
export function toIsoDate(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

/** Parse `YYYY-MM-DD` as local midnight. Anything else is null. */
export function parseIsoDate(value: string | null | undefined): Date | null {
    if (!value) return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return Number.isNaN(date.getTime()) ? null : date;
}

export function isIsoDate(value: unknown): value is string {
    return typeof value === "string" && parseIsoDate(value) !== null;
}

/** Monday of the week containing `date`. */
export function weekStartOf(date: Date): string {
    const day = date.getDay(); // 0 Sunday … 6 Saturday
    const back = day === 0 ? 6 : day - 1;
    const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate() - back);
    return toIsoDate(monday);
}

export function addDays(iso: string, days: number): string {
    const date = parseIsoDate(iso);
    if (!date) throw new Error(`Not a date: ${iso}`);
    return toIsoDate(new Date(date.getFullYear(), date.getMonth(), date.getDate() + days));
}

/** Sunday of the week that starts on `weekStart`. */
export function weekEndOf(weekStart: string): string {
    return addDays(weekStart, 6);
}

/**
 * The week whose agenda is being prepared. Monday to Wednesday the meeting
 * is still ahead this week; from Thursday the draft is for next week — the
 * brief's "on Thursday or Friday, Vantage prepares next week's agenda".
 */
export function defaultAgendaWeek(now: Date): string {
    const thisWeek = weekStartOf(now);
    const day = now.getDay();
    const fromThursday = day === 0 || day >= 4;
    return fromThursday ? addDays(thisWeek, 7) : thisWeek;
}

/** Whole days from `a` to `b` (negative when `b` is earlier). */
export function daysBetween(a: string, b: string): number {
    const from = parseIsoDate(a);
    const to = parseIsoDate(b);
    if (!from || !to) throw new Error(`Not a date: ${a} / ${b}`);
    return Math.round((to.getTime() - from.getTime()) / DAY_MS);
}

/** "Week of 14 Sep" — the label a rail or a list shows for a week. */
export function weekLabel(weekStart: string): string {
    const date = parseIsoDate(weekStart);
    if (!date) return weekStart;
    return `Week of ${date.toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
}
