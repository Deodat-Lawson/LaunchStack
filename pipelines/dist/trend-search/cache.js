/**
 * In-memory cache for trend search results.
 * Reduces redundant API calls (Exa/Serper) and LLM work when the same
 * query + company context is used within the TTL window.
 *
 * Mechanism lives in @launchstack/tools/web-research (`createTtlCache`,
 * unification PR-3); this module owns the trend-search key shape and TTL.
 */
import { createTtlCache } from "@launchstack/tools/web-research";
const TTL_MS = 60 * 60 * 1000; // 1 hour – trends don't change that fast
const cache = createTtlCache({ ttlMs: TTL_MS, maxEntries: 100 });
function buildCacheKey(query, companyContext) {
    return `${query.trim().replace(/\s+/g, " ")}::${companyContext.trim().replace(/\s+/g, " ")}`;
}
export function getCachedTrendSearch(query, companyContext) {
    return cache.get(buildCacheKey(query, companyContext));
}
export function setCachedTrendSearch(query, companyContext, output) {
    cache.set(buildCacheKey(query, companyContext), output);
}
//# sourceMappingURL=cache.js.map