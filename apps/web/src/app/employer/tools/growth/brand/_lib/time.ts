import type { BrandPost, BrandPostStatus } from "../api";

const DAY = 86_400_000;

/** Monday 00:00 local of the week containing `d`. */
export function startOfWeek(d: Date): Date {
    const out = new Date(d);
    out.setHours(0, 0, 0, 0);
    const day = (out.getDay() + 6) % 7; // Monday = 0
    out.setDate(out.getDate() - day);
    return out;
}

export function addDays(d: Date, n: number): Date {
    const out = new Date(d);
    out.setDate(out.getDate() + n);
    return out;
}

export function sameDay(a: Date, b: Date): boolean {
    return (
        a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth() &&
        a.getDate() === b.getDate()
    );
}

/** The moment a post sits on the calendar: due time, else when it went out, else when it was written. */
export function postMoment(post: BrandPost): Date {
    return new Date(post.scheduledAt ?? post.publishedAt ?? post.createdAt);
}

export function timeOfDay(d: Date): string {
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function weekday(d: Date): string {
    return d.toLocaleDateString(undefined, { weekday: "short" });
}

export function dayNumber(d: Date): string {
    return d.toLocaleDateString(undefined, { day: "numeric" });
}

export function monthYear(d: Date): string {
    return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

export function dayAndMonth(d: Date): string {
    return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

/** For `<input type="datetime-local">`: local time without seconds. */
export function toLocalInput(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The next round quarter hour at least ten minutes out: a sensible default schedule. */
export function nextSlot(now = new Date()): Date {
    const t = new Date(now.getTime() + 10 * 60_000);
    t.setSeconds(0, 0);
    t.setMinutes(Math.ceil(t.getMinutes() / 15) * 15);
    return t;
}

export function weekRange(weekStart: Date): { from: string; to: string } {
    return { from: weekStart.toISOString(), to: addDays(weekStart, 7).toISOString() };
}

export const STATUS_WORD: Record<BrandPostStatus, string> = {
    draft: "Draft",
    scheduled: "Scheduled",
    publishing: "Publishing",
    published: "Published",
    failed: "Failed",
    cancelled: "Cancelled",
};

export function isDue(post: BrandPost, now = Date.now()): boolean {
    return (
        post.status === "scheduled" &&
        post.scheduledAt !== null &&
        new Date(post.scheduledAt).getTime() <= now
    );
}

export { DAY };
