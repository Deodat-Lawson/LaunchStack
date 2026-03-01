import { env } from "~/env";
import type { SearchExecutionResult, SearchProviderFn, ProviderStrategy } from "~/lib/tools/trend-search/providers/types";
import { providerRegistry } from "~/lib/tools/trend-search/providers/registry";
import type { PlannedQuery, RawSearchResult } from "~/lib/tools/trend-search/types";

const MAX_RETRIES = 2;

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
async function executeWithProvider(
    subQueries: PlannedQuery[],
    providerFn: SearchProviderFn,
): Promise<RawSearchResult[]> {
    const seenUrls = new Set<string>();
    const combined: RawSearchResult[] = [];

    for (const sub of subQueries) {
        const query = sub.searchQuery;
        let lastError: Error | null = null;
        let results: RawSearchResult[] = [];

        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            try {
                results = await providerFn(query);
                lastError = null;
                break;
            } catch (err) {
                lastError = err instanceof Error ? err : new Error(String(err));
                if (attempt < MAX_RETRIES) {
                    console.warn(
                        `[web-search] Sub-query failed (attempt ${attempt + 1}/${MAX_RETRIES + 1}): "${query.slice(0, 50)}..."`,
                        lastError.message,
                    );
                } else {
                    console.error(
                        `[web-search] Sub-query failed after ${MAX_RETRIES + 1} attempts: "${query.slice(0, 50)}..."`,
                        lastError,
                    );
                }
            }
        }

        if (results.length === 0 && lastError) {
            continue;
        }
        if (results.length === 0) {
            console.warn(`[web-search] Zero results for sub-query: "${query.slice(0, 80)}..."`);
            continue;
        }

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

/** Resolve strategy: override → env → default. Downgrade to tavily if Serper required but key missing. */
function resolveStrategy(strategyOverride?: ProviderStrategy): ProviderStrategy {
    const fromEnv = env.server.SEARCH_PROVIDER ?? "tavily";
    const strategy: ProviderStrategy = strategyOverride ?? (fromEnv as ProviderStrategy);

    const needsSerper: ProviderStrategy[] = ["serper", "fallback", "parallel"];
    if (needsSerper.includes(strategy) && !env.server.SERPER_API_KEY) {
        console.warn(
            "[web-search] SERPER_API_KEY not set; downgrading strategy to tavily.",
        );
        return "tavily";
    }

    return strategy;
}

/** Merge two result arrays by URL; on collision keep the result with the higher score. */
function mergeDedupByUrl(
    a: RawSearchResult[],
    b: RawSearchResult[],
): RawSearchResult[] {
    const byUrl = new Map<string, RawSearchResult>();
    for (const r of [...a, ...b]) {
        const key = normalizeUrl(r.url);
        if (!key) continue;
        const existing = byUrl.get(key);
        if (!existing || r.score > existing.score) {
            byUrl.set(key, r);
        }
    }
    return [...byUrl.values()];
}

/**
 * Executes sub-queries using the configured provider strategy.
 *
 * @param subQueries - Planned queries from the query planner.
 * @param strategyOverride - Optional override for SEARCH_PROVIDER.
 * @returns SearchExecutionResult (results + providerUsed).
 */
export async function executeSearch(
    subQueries: PlannedQuery[],
    strategyOverride?: ProviderStrategy,
): Promise<SearchExecutionResult> {
    const strategy = resolveStrategy(strategyOverride);
    const tavily = providerRegistry.tavily!;
    const serper = providerRegistry.serper!;

    if (strategy === "tavily" || strategy === "serper") {
        const providerFn = providerRegistry[strategy];
        if (!providerFn) {
            console.warn(`[web-search] Unknown provider "${strategy}"; falling back to tavily.`);
            const results = await executeWithProvider(subQueries, tavily);
            return { results, providerUsed: "tavily" };
        }
        const results = await executeWithProvider(subQueries, providerFn);
        return { results, providerUsed: strategy };
    }

    if (strategy === "fallback") {
        const primaryResults = await executeWithProvider(subQueries, serper);
        if (primaryResults.length > 0) {
            return { results: primaryResults, providerUsed: "serper" };
        }
        console.warn("[web-search] Serper returned no results; falling back to Tavily.");
        const fallbackResults = await executeWithProvider(subQueries, tavily);
        return { results: fallbackResults, providerUsed: "tavily (fallback)" };
    }

    if (strategy === "parallel") {
        const [serperResults, tavilyResults] = await Promise.all([
            executeWithProvider(subQueries, serper),
            executeWithProvider(subQueries, tavily),
        ]);
        const results = mergeDedupByUrl(serperResults, tavilyResults);
        return { results, providerUsed: "tavily+serper" };
    }

    // Unreachable if strategy type is correct; defensive fallback
    const results = await executeWithProvider(subQueries, tavily);
    return { results, providerUsed: "tavily" };
}
