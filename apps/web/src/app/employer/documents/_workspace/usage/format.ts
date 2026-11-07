"use client";

/**
 * Numbers, money, days and chart colours for the Usage tab — and for the
 * Spending screen's older charts, so every chart in the tab shares one set.
 *
 * Series colours are design tokens in a fixed order: the window's four
 * biggest features by AI tokens, then Other in muted ink. Dark mode uses
 * darker steps of the same hues, validated against the dark surface rather
 * than flipped.
 */

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";

import type { ChartConfig } from "~/components/ui/chart";
import { isAiFeature, isAiUsageRoute } from "~/lib/ai-usage";

/** The four series colours, in rank order; anything past them is Other. */
export const SERIES_THEMES = [
    { light: "var(--accent)", dark: "oklch(from var(--accent-2) 0.62 c h)" },
    { light: "var(--hue-teal)", dark: "oklch(from var(--hue-teal) 0.62 c h)" },
    { light: "var(--warn)", dark: "oklch(from var(--warn) 0.66 c h)" },
    { light: "var(--info)", dark: "oklch(from var(--info) 0.6 c h)" },
] as const;

/** One series alone (a single metric): the first colour. */
export const SINGLE_SERIES_THEME = SERIES_THEMES[0];

export const OTHER_SERIES = "other";

/**
 * One zero-filled row per day, so the axis is a calendar. Keys in `series`
 * keep their own column; everything else adds up under Other.
 */
export function calendarRows(
    dates: readonly string[],
    byDate: Map<string, Record<string, number>>,
    series: readonly string[]
): Array<Record<string, number | string>> {
    return dates.map(date => {
        const row: Record<string, number | string> = { date };
        let other = 0;
        for (const [key, value] of Object.entries(byDate.get(date) ?? {})) {
            if (series.includes(key)) row[key] = value;
            else other += value;
        }
        for (const key of series) row[key] ??= 0;
        row[OTHER_SERIES] = other;
        return row;
    });
}

/** A chart config for `series` (in rank order, coloured by rank) plus Other. */
export function seriesConfig(
    series: readonly string[],
    label: (key: string) => string,
    otherLabel: string
): ChartConfig {
    const config: ChartConfig = {};
    series.forEach((key, index) => {
        config[key] = { label: label(key), theme: SERIES_THEMES[index]! };
    });
    config[OTHER_SERIES] = { label: otherLabel, color: "var(--ink-4)" };
    return config;
}

export interface UsageFormat {
    locale: string;
    /** 12,345 */
    num: (n: number) => string;
    /** 12K, 1.2M — 1.2万 in Chinese. */
    compact: (n: number) => string;
    /** $1.23; sub-cent amounts keep enough digits to be more than $0.00. "—" for unknown. */
    usd: (value: number | null) => string;
    /** 42% */
    percent: (value: number) => string;
    /** Oct 27 */
    day: (iso: string) => string;
    /** Oct 27, 2026 */
    longDay: (iso: string) => string;
    /** A feature id's name (`settings.usage.models.features`). */
    feature: (id: string) => string;
    /** A route id's name (`settings.usage.models.routes`). */
    route: (id: string) => string;
}

export function useUsageFormat(): UsageFormat {
    const locale = useLocale();
    const tModels = useTranslations("settings.usage.models");
    return useMemo(() => {
        const numberFormat = new Intl.NumberFormat(locale);
        const compactFormat = new Intl.NumberFormat(locale, {
            notation: "compact",
            maximumFractionDigits: 1,
        });
        const dayFormat = new Intl.DateTimeFormat(locale, {
            month: "short",
            day: "numeric",
            timeZone: "UTC",
        });
        const longDayFormat = new Intl.DateTimeFormat(locale, {
            dateStyle: "medium",
            timeZone: "UTC",
        });
        const asDate = (iso: string) => new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
        return {
            locale,
            num: n => numberFormat.format(n),
            compact: n => (Math.abs(n) < 1000 ? numberFormat.format(n) : compactFormat.format(n)),
            usd: value =>
                value === null
                    ? "—"
                    : value.toLocaleString(locale, {
                          style: "currency",
                          currency: "USD",
                          minimumFractionDigits: 2,
                          maximumFractionDigits: value > 0 && value < 0.01 ? 4 : 2,
                      }),
            percent: value => `${Math.round(value)}%`,
            day: iso => dayFormat.format(asDate(iso)),
            longDay: iso => longDayFormat.format(asDate(iso)),
            feature: id => (isAiFeature(id) ? tModels(`features.${id}`) : id),
            route: id => (isAiUsageRoute(id) ? tModels(`routes.${id}`) : id),
        };
    }, [locale, tModels]);
}

/**
 * The change from the previous window, as a share of it: 0 when nothing
 * moved (none then, none now included), null when it went up from nothing.
 */
export function changeOf(current: number, previous: number): number | null {
    if (previous <= 0) return current > 0 ? null : 0;
    const change = ((current - previous) / previous) * 100;
    return Math.abs(change) < 0.5 ? 0 : change;
}
