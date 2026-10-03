/** Formatting in the product's words; all inputs are ISO dates or numbers. */

export function todayIso(now = new Date()): string {
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

function parse(iso: string | null | undefined): Date | null {
    if (!iso) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d;
}

/** "12 Sep" */
export function fmtDate(iso: string | null | undefined): string {
    const d = parse(iso);
    if (!d) return "—";
    return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** "12 Sep 2026" */
export function fmtDateLong(iso: string | null | undefined): string {
    const d = parse(iso);
    if (!d) return "—";
    return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** "Week of 5 Oct" */
export function weekLabel(weekStart: string): string {
    return `Week of ${fmtDate(weekStart)}`;
}

/** "5–11 Oct" */
export function weekRange(weekStart: string, weekEnd: string): string {
    const a = parse(weekStart);
    const b = parse(weekEnd);
    if (!a || !b) return weekStart;
    const sameMonth = a.getMonth() === b.getMonth();
    const day = (d: Date) => d.toLocaleDateString(undefined, { day: "numeric" });
    const month = (d: Date) => d.toLocaleDateString(undefined, { month: "short" });
    return sameMonth
        ? `${day(a)}–${day(b)} ${month(b)}`
        : `${day(a)} ${month(a)} – ${day(b)} ${month(b)}`;
}

/** Whole days from today to `iso`; negative when past. */
export function daysUntil(iso: string, today = todayIso()): number {
    const a = parse(today)!;
    const b = parse(iso);
    if (!b) return 0;
    return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/** "due today", "in 3 days", "4 days late" */
export function dueWords(iso: string, today = todayIso()): string {
    const n = daysUntil(iso, today);
    if (n === 0) return "due today";
    if (n === 1) return "due tomorrow";
    if (n > 1) return `in ${n} days`;
    if (n === -1) return "1 day late";
    return `${-n} days late`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
    return `${n} ${n === 1 ? one : many}`;
}

export function fmtNumber(value: number, unit = "count"): string {
    const n = Number.isInteger(value)
        ? value.toLocaleString()
        : value.toLocaleString(undefined, { maximumFractionDigits: 2 });
    if (unit === "percent" || unit === "%") return `${n}%`;
    if (unit === "count" || unit === "") return n;
    if (unit === "usd" || unit === "$") return `$${n}`;
    if (unit === "eur" || unit === "€") return `€${n}`;
    return `${n} ${unit}`;
}

/** "+25%" / "−8%" / "+12" (when there is no percentage) */
export function fmtChange(pct: number | null, delta: number | null, unit = "count"): string {
    if (pct !== null)
        return `${pct > 0 ? "+" : pct < 0 ? "−" : ""}${Math.abs(Math.round(pct * 100))}%`;
    if (delta !== null)
        return `${delta > 0 ? "+" : delta < 0 ? "−" : ""}${fmtNumber(Math.abs(delta), unit)}`;
    return "";
}

export function addDaysIso(iso: string, days: number): string {
    const d = parse(iso) ?? new Date();
    return todayIso(new Date(d.getFullYear(), d.getMonth(), d.getDate() + days));
}

/** "just now", "3 days ago", "12 Sep" */
export function agoWords(iso: string | null | undefined, now = new Date()): string {
    if (!iso) return "never";
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return "never";
    const minutes = Math.round((now.getTime() - then) / 60_000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} hours ago`;
    const days = Math.round(hours / 24);
    if (days === 1) return "yesterday";
    if (days < 30) return `${days} days ago`;
    return fmtDate(iso);
}
