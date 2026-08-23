/**
 * In-memory cache for trend search results.
 * Reduces redundant API calls (Exa/Serper) and LLM work when the same
 * query + company context is used within the TTL window.
 *
 * Mechanism lives in @launchstack/tools/web-research (`createTtlCache`,
 * unification PR-3); this module owns the trend-search key shape and TTL.
 */
import { createTtlCache } from "@launchstack/tools/web-research";
import type { TrendSearchOutput } from "./types";

const TTL_MS = 60 * 60 * 1000; // 1 hour – trends don't change that fast

const cache = createTtlCache<TrendSearchOutput>({ ttlMs: TTL_MS, maxEntries: 100 });

function buildCacheKey(query: string, companyContext: string): string {
    return `${query.trim().replace(/\s+/g, " ")}::${companyContext.trim().replace(/\s+/g, " ")}`;
}

export function getCachedTrendSearch(
    query: string,
    companyContext: string
): TrendSearchOutput | null {
    return cache.get(buildCacheKey(query, companyContext));
}

export function setCachedTrendSearch(
    query: string,
    companyContext: string,
    output: TrendSearchOutput
): void {
    cache.set(buildCacheKey(query, companyContext), output);
}
