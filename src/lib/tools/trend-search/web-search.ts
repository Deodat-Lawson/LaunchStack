import { callTavily } from "~/lib/tools/trend-search/providers/tavily";
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
 * Executes sub-queries against Tavily and returns combined, deduplicated raw results for synthesis.
 *
 * @param subQueries - Planned queries from the query planner.
 * @returns Combined RawSearchResult[] (deduplicated by URL).
 */
export async function executeSearch(
    subQueries: PlannedQuery[],
): Promise<RawSearchResult[]> {
    const seenUrls = new Set<string>();
    const combined: RawSearchResult[] = [];

    for (const sub of subQueries) {
        const query = sub.searchQuery;
        let lastError: Error | null = null;
        let results: RawSearchResult[] = [];

        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            try {
                results = await callTavily(query);
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
