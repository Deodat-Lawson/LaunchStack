/**
 * web-research — web search through one provider-agnostic layer, plus page
 * reading and a shared TTL cache.
 *
 * `SEARCH_PROVIDER` picks the engine (Exa, Serper, Brave, Tavily or SearXNG;
 * see ./setup) and every search goes to it: `searchWeb` for the whole web,
 * `executeSearch` below for news (trend research, with retry and URL dedup),
 * `searchCompanies` / `describeCompanies` where the engine has a company index.
 *
 * Moved down from packages/features/src/trend-search (unification PR-3): this
 * is the capability; the trend-search vertical keeps its query planning,
 * synthesis, job store, and Inngest orchestration and imports this tool.
 */

import { resolveSearchSetup } from "./setup";
import type { PlannedQuery, RawSearchResult, SearchExecutionResult, SearchProvider } from "./types";

export * from "./types";
export { createTtlCache, type TtlCache } from "./cache";
export { SEARCH_PROVIDERS } from "./providers/registry";
export {
    activeSearchProvider,
    describeSearchSetup,
    isSearchProviderId,
    resolveSearchSetup,
    type SearchSetup,
    type SearchSetupProblem,
    type SearchSetupView,
} from "./setup";
export * from "./fetch";
export * from "./web-search";

const MAX_RETRIES = 2;
const RESULTS_PER_QUERY = 10;
/** News articles are the evidence trend synthesis reads, so keep most of each. */
const NEWS_TEXT_CHARS = 4_000;

/** Normalize URL for deduplication; falls back to trim if invalid. */
function normalizeUrl(url: string): string {
    try {
        return new URL(url).href;
    } catch {
        return url.trim();
    }
}

/**
 * Runs all sub-queries through a single provider with retry and URL deduplication.
 * @returns Combined RawSearchResult[] (deduplicated by URL).
 */
async function runSubQueryWithRetry(
    query: string,
    provider: SearchProvider
): Promise<RawSearchResult[]> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            const hits = await provider.search(query, {
                kind: "news",
                maxResults: RESULTS_PER_QUERY,
                snippetChars: NEWS_TEXT_CHARS,
                timeoutMs: 20_000,
            });
            // Engines score on different scales; rank within the answer is comparable.
            return hits.map((hit, index) => ({
                url: hit.url,
                title: hit.title,
                content: hit.snippet,
                score: Math.max(0, 1 - index / hits.length),
                ...(hit.publishedDate ? { publishedDate: hit.publishedDate } : {}),
            }));
        } catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err));
            if (attempt < MAX_RETRIES) {
                console.warn(
                    `[web-search] Sub-query failed (attempt ${
                        attempt + 1
                    }/${MAX_RETRIES + 1}): "${query.slice(0, 50)}..."`,
                    lastError.message
                );
            } else {
                console.error(
                    `[web-search] Sub-query failed after ${
                        MAX_RETRIES + 1
                    } attempts: "${query.slice(0, 50)}..."`,
                    lastError
                );
            }
        }
    }

    if (lastError) return [];

    console.warn(`[web-search] Zero results for sub-query: "${query.slice(0, 80)}..."`);
    return [];
}

async function executeWithProvider(
    subQueries: PlannedQuery[],
    provider: SearchProvider
): Promise<RawSearchResult[]> {
    const perQueryResults = await Promise.all(
        subQueries.map(sub => runSubQueryWithRetry(sub.searchQuery, provider))
    );

    const seenUrls = new Set<string>();
    const combined: RawSearchResult[] = [];

    for (const results of perQueryResults) {
        for (const r of results) {
            const normalizedUrl = normalizeUrl(r.url);
            if (normalizedUrl && !seenUrls.has(normalizedUrl)) {
                seenUrls.add(normalizedUrl);
                combined.push(r);
            }
        }
    }

    return combined;
}

/**
 * News search for trend research: every sub-query through the configured
 * provider's news search, with retry, merged and de-duplicated by URL.
 * Searches nothing (providerUsed "none") when web search is off.
 */
export async function executeSearch(subQueries: PlannedQuery[]): Promise<SearchExecutionResult> {
    const { provider } = resolveSearchSetup();
    if (!provider) return { results: [], providerUsed: "none" };
    const results = await executeWithProvider(subQueries, provider);
    return { results, providerUsed: provider.id };
}
