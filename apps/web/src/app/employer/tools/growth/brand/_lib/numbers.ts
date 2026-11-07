import type { BrandPostMetrics } from "../api";

/**
 * Numbers as the Brand screens print them. A null is "—" (the network does
 * not report it), never 0, which would claim nobody looked.
 */

const FULL = new Map<string, Intl.NumberFormat>();
const COMPACT = new Map<string, Intl.NumberFormat>();

/** One formatter per locale, made the first time that locale asks. */
function formatter(
    cache: Map<string, Intl.NumberFormat>,
    locale: string,
    options?: Intl.NumberFormatOptions
): Intl.NumberFormat {
    let f = cache.get(locale);
    if (!f) {
        f = new Intl.NumberFormat(locale, options);
        cache.set(locale, f);
    }
    return f;
}

export const NONE = "—";

/** "1,284"; "—" for null. `locale` is the interface language (`useLocale()`). */
export function count(n: number | null | undefined, locale = "en-US"): string {
    return n === null || n === undefined || Number.isNaN(n)
        ? NONE
        : formatter(FULL, locale).format(n);
}

/** "1,284" under ten thousand, then "12.4K", "1.2M": for stat tiles and compact rows. */
export function compact(n: number | null | undefined, locale = "en-US"): string {
    if (n === null || n === undefined || Number.isNaN(n)) return NONE;
    return Math.abs(n) < 10_000
        ? formatter(FULL, locale).format(n)
        : formatter(COMPACT, locale, { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

/** A 0..1 rate as "4.2%"; "—" for null. */
export function percent(rate: number | null | undefined): string {
    if (rate === null || rate === undefined || Number.isNaN(rate)) return NONE;
    const pct = rate * 100;
    return `${pct >= 10 ? pct.toFixed(0) : pct.toFixed(1)}%`;
}

/**
 * A post's engagement rate: the network's own figure when it gives one,
 * else interactions over impressions, else null (no impressions, no rate).
 */
export function engagementOf(metrics: BrandPostMetrics | null | undefined): number | null {
    if (!metrics) return null;
    if (metrics.engagement !== null) return metrics.engagement;
    if (!metrics.impressions) return null;
    const interactions =
        metrics.reactions + metrics.comments + metrics.shares + (metrics.clicks ?? 0);
    return interactions / metrics.impressions;
}

export type SortDir = "asc" | "desc";

/**
 * Rows sorted by one value. Nulls go last in both directions — an
 * unreported number is not the smallest one — and ties keep their order.
 */
export function sortRows<T>(
    rows: readonly T[],
    value: (row: T) => number | string | null | undefined,
    dir: SortDir
): T[] {
    const sign = dir === "asc" ? 1 : -1;
    return rows
        .map((row, index) => ({ row, index, v: value(row) }))
        .sort((a, b) => {
            const an = a.v === null || a.v === undefined;
            const bn = b.v === null || b.v === undefined;
            if (an || bn) return an === bn ? a.index - b.index : an ? 1 : -1;
            const c =
                typeof a.v === "number" && typeof b.v === "number"
                    ? a.v - b.v
                    : String(a.v).localeCompare(String(b.v));
            return c !== 0 ? c * sign : a.index - b.index;
        })
        .map(x => x.row);
}
