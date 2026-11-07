/**
 * Formatting in the product's words; all inputs are ISO dates or numbers.
 *
 * Dates and numbers follow the interface language: the plain functions take
 * the locale, and `useVantageFormat()` binds it, with the `vantage`
 * messages, for everything that is said in words ("due tomorrow",
 * "3 days ago", "5–11 Oct"). Helpers outside components (the one-click
 * builders, the week's steps) take the same `VantageFormat`.
 */
import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";

/** A translator for all of `vantage`, which the shared helpers say things with. */
export type VantageT = ReturnType<typeof useTranslations<"vantage">>;

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
export function fmtDate(iso: string | null | undefined, locale?: string): string {
    const d = parse(iso);
    if (!d) return "—";
    return d.toLocaleDateString(locale, { day: "numeric", month: "short" });
}

/** "12 Sep 2026" */
export function fmtDateLong(iso: string | null | undefined, locale?: string): string {
    const d = parse(iso);
    if (!d) return "—";
    return d.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
}

/** Whole days from today to `iso`; negative when past. */
export function daysUntil(iso: string, today = todayIso()): number {
    const a = parse(today)!;
    const b = parse(iso);
    if (!b) return 0;
    return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

export function fmtNumber(value: number, unit = "count", locale?: string): string {
    const n = Number.isInteger(value)
        ? value.toLocaleString(locale)
        : value.toLocaleString(locale, { maximumFractionDigits: 2 });
    if (unit === "percent" || unit === "%") return `${n}%`;
    if (unit === "count" || unit === "") return n;
    if (unit === "usd" || unit === "$") return `$${n}`;
    if (unit === "eur" || unit === "€") return `€${n}`;
    return `${n} ${unit}`;
}

/** "+25%" / "−8%" / "+12" (when there is no percentage) */
export function fmtChange(
    pct: number | null,
    delta: number | null,
    unit = "count",
    locale?: string
): string {
    if (pct !== null)
        return `${pct > 0 ? "+" : pct < 0 ? "−" : ""}${Math.abs(Math.round(pct * 100)).toLocaleString(locale)}%`;
    if (delta !== null)
        return `${delta > 0 ? "+" : delta < 0 ? "−" : ""}${fmtNumber(Math.abs(delta), unit, locale)}`;
    return "";
}

export function addDaysIso(iso: string, days: number): string {
    const d = parse(iso) ?? new Date();
    return todayIso(new Date(d.getFullYear(), d.getMonth(), d.getDate() + days));
}

/**
 * Everything Vantage says about dates, numbers and lists, in the reader's
 * language. `t` is the whole `vantage` namespace, so the helpers that take
 * this object can say their own words with it too.
 */
export function vantageFormat(t: VantageT, locale: string) {
    const date = (iso: string | null | undefined) => fmtDate(iso, locale);
    const part = (d: Date, options: Intl.DateTimeFormatOptions) =>
        d.toLocaleDateString(locale, options);
    /** A value in its unit; the built-in time units are words, so they are translated. */
    const number = (value: number, unit?: string): string =>
        unit === "minutes" || unit === "days"
            ? t(`format.units.${unit}`, { value: fmtNumber(value, "count", locale) })
            : fmtNumber(value, unit, locale);
    return {
        t,
        locale,
        date,
        dateLong: (iso: string | null | undefined) => fmtDateLong(iso, locale),
        number,
        /** "+25%" / "−8%" / "+12 days" (when there is no percentage) */
        change: (pct: number | null, delta: number | null, unit?: string): string => {
            if (pct !== null || delta === null) return fmtChange(pct, delta, unit, locale);
            return `${delta > 0 ? "+" : delta < 0 ? "−" : ""}${number(Math.abs(delta), unit)}`;
        },

        /** "Week of 5 Oct" */
        weekOf: (weekStart: string) => t("format.weekOf", { date: date(weekStart) }),

        /** "5–11 Oct" */
        weekRange: (weekStart: string, weekEnd: string): string => {
            const a = parse(weekStart);
            const b = parse(weekEnd);
            if (!a || !b) return weekStart;
            const day = (d: Date) => part(d, { day: "numeric" });
            const month = (d: Date) => part(d, { month: "short" });
            return a.getMonth() === b.getMonth()
                ? t("format.weekRange.sameMonth", {
                      startDay: day(a),
                      endDay: day(b),
                      month: month(b),
                  })
                : t("format.weekRange.crossMonth", {
                      startDay: day(a),
                      startMonth: month(a),
                      endDay: day(b),
                      endMonth: month(b),
                  });
        },

        /** "due today", "in 3 days", "4 days late" */
        due: (iso: string, today = todayIso()): string => {
            const n = daysUntil(iso, today);
            if (n === 0) return t("format.due.today");
            if (n === 1) return t("format.due.tomorrow");
            if (n > 1) return t("format.due.inDays", { count: n });
            return t("format.due.late", { count: -n });
        },

        /** "just now", "3 days ago", "12 Sep" */
        ago: (iso: string | null | undefined, now = new Date()): string => {
            if (!iso) return t("format.ago.never");
            const then = new Date(iso).getTime();
            if (Number.isNaN(then)) return t("format.ago.never");
            const minutes = Math.round((now.getTime() - then) / 60_000);
            if (minutes < 1) return t("format.ago.justNow");
            if (minutes < 60) return t("format.ago.minutes", { count: minutes });
            const hours = Math.round(minutes / 60);
            if (hours < 24) return t("format.ago.hours", { count: hours });
            const days = Math.round(hours / 24);
            if (days === 1) return t("format.ago.yesterday");
            if (days < 30) return t("format.ago.days", { count: days });
            return date(iso);
        },

        /** "a", "a and b", "a, b and c" */
        list: (items: string[]): string => {
            if (items.length <= 1) return items.join("");
            return t("format.list.last", {
                rest: items.slice(0, -1).join(t("format.list.separator")),
                last: items[items.length - 1]!,
            });
        },
    };
}

export type VantageFormat = ReturnType<typeof vantageFormat>;

/** `vantageFormat` for the current language, stable across renders. */
export function useVantageFormat(): VantageFormat {
    const t = useTranslations("vantage");
    const locale = useLocale();
    return useMemo(() => vantageFormat(t, locale), [t, locale]);
}
