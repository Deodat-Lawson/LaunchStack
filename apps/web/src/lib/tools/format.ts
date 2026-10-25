import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";

/** Relative time in the product's words: "today", "yesterday", "12 days ago". */
export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
    if (!iso) return "never";
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return "never";
    const minutes = Math.round((now - then) / 60_000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) {
        const sameDay = new Date(then).toDateString() === new Date(now).toDateString();
        return sameDay
            ? `today ${new Date(then).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`
            : `${hours} hours ago`;
    }
    const startOfDay = (t: number) => new Date(t).setHours(0, 0, 0, 0);
    const days = Math.round((startOfDay(now) - startOfDay(then)) / 86_400_000);
    if (days <= 1) return "yesterday";
    if (days < 30) return `${days} days ago`;
    return new Date(then).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function shortDate(iso: string | null | undefined): string {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function duration(ms: number): string {
    if (ms < 1000) return `${ms} ms`;
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s} s`;
    const m = Math.floor(s / 60);
    const rest = s % 60;
    return rest ? `${m} min ${rest} s` : `${m} min`;
}

export function money(usd: number): string {
    return `€${usd.toFixed(2)}`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
    return `${n} ${n === 1 ? one : many}`;
}

/** "NL, DE and the UK" from ["NL","DE","GB"]. */
export function joinNatural(items: string[]): string {
    if (items.length <= 1) return items.join("");
    return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

// ─── In the reader's language ───────────────────────────────────────────────
//
// The functions above answer in English and stay for the screens that have
// not moved to messages yet. `useToolFormat()` is the same set in the
// reader's language: words from `tools.format`, dates in their locale.

export type ToolFormatTranslator = ReturnType<typeof useTranslations<"tools.format">>;

export interface ToolFormat {
    /** "today 14:05", "yesterday", "12 days ago" — or 今天 14:05, 昨天, 12 天前. */
    relativeTime: (iso: string | null | undefined, now?: number) => string;
    shortDate: (iso: string | null | undefined) => string;
    duration: (ms: number) => string;
    /** "NL, DE and GB" — or NL、DE和GB. */
    joinNatural: (items: string[]) => string;
}

/** `useToolFormat` for code that already holds a `tools.format` translator and the locale. */
export function toolFormat(t: ToolFormatTranslator, locale: string): ToolFormat {
    const day = (then: number) =>
        new Date(then).toLocaleDateString(locale, { month: "short", day: "numeric" });
    return {
        relativeTime: (iso, now = Date.now()) => {
            if (!iso) return t("never");
            const then = new Date(iso).getTime();
            if (Number.isNaN(then)) return t("never");
            const minutes = Math.round((now - then) / 60_000);
            if (minutes < 1) return t("justNow");
            if (minutes < 60) return t("minutesAgo", { minutes });
            const hours = Math.round(minutes / 60);
            if (hours < 24) {
                const sameDay = new Date(then).toDateString() === new Date(now).toDateString();
                return sameDay
                    ? t("todayAt", {
                          time: new Date(then).toLocaleTimeString(locale, {
                              hour: "2-digit",
                              minute: "2-digit",
                          }),
                      })
                    : t("hoursAgo", { hours });
            }
            const startOfDay = (ms: number) => new Date(ms).setHours(0, 0, 0, 0);
            const days = Math.round((startOfDay(now) - startOfDay(then)) / 86_400_000);
            if (days <= 1) return t("yesterday");
            if (days < 30) return t("daysAgo", { days });
            return day(then);
        },
        shortDate: iso => {
            if (!iso) return "—";
            const then = new Date(iso).getTime();
            return Number.isNaN(then) ? "—" : day(then);
        },
        duration: ms => {
            if (ms < 1000) return t("milliseconds", { ms });
            const s = Math.round(ms / 1000);
            if (s < 60) return t("seconds", { s });
            const m = Math.floor(s / 60);
            const rest = s % 60;
            return rest ? t("minutesSeconds", { m, s: rest }) : t("minutes", { m });
        },
        joinNatural: items => {
            if (items.length <= 1) return items.join("");
            return t("listJoin", {
                rest: items.slice(0, -1).join(t("listSeparator")),
                last: items[items.length - 1]!,
            });
        },
    };
}

/** Relative times, dates, durations and lists in the reader's language. */
export function useToolFormat(): ToolFormat {
    const t = useTranslations("tools.format");
    const locale = useLocale();
    return useMemo(() => toolFormat(t, locale), [t, locale]);
}
