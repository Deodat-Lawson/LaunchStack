import { providerRegistry } from "./providers/registry.js";
const MAX_RETRIES = 2;
/** Normalize URL for deduplication; falls back to trim if invalid. */
function normalizeUrl(url) {
    try {
        return new URL(url).href;
    }
    catch {
        return url.trim();
    }
}
/**
 * Runs all sub-queries through a single provider with retry and URL deduplication.
 * @returns Combined RawSearchResult[] (deduplicated by URL).
 */
async function runSubQueryWithRetry(query, provider) {
    let lastError = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            return await provider(query);
        }
        catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err));
            if (attempt < MAX_RETRIES) {
                console.warn(`[web-search] Sub-query failed (attempt ${attempt + 1}/${MAX_RETRIES + 1}): "${query.slice(0, 50)}..."`, lastError.message);
            }
            else {
                console.error(`[web-search] Sub-query failed after ${MAX_RETRIES + 1} attempts: "${query.slice(0, 50)}..."`, lastError);
            }
        }
    }
    if (lastError)
        return [];
    console.warn(`[web-search] Zero results for sub-query: "${query.slice(0, 80)}..."`);
    return [];
}
async function executeWithProvider(subQueries, provider) {
    const perQueryResults = await Promise.all(subQueries.map(sub => runSubQueryWithRetry(sub.searchQuery, provider)));
    const seenUrls = new Set();
    const combined = [];
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
function resolveStrategy(override) {
    if (override)
        return override;
    const fromEnv = process.env.SEARCH_PROVIDER;
    if (fromEnv === "serper" || fromEnv === "fallback" || fromEnv === "parallel") {
        return fromEnv;
    }
    return "exa";
}
function getProvider(name) {
    const provider = providerRegistry[name];
    if (!provider) {
        console.warn(`[web-search] Unknown provider "${name}", skipping.`);
        return null;
    }
    return provider;
}
export async function executeSearch(subQueries, strategyOverride) {
    const strategy = resolveStrategy(strategyOverride);
    const hasExaKey = Boolean(process.env.EXA_API_KEY);
    const hasSerperKey = Boolean(process.env.SERPER_API_KEY);
    const useSerper = hasSerperKey &&
        (strategy === "serper" || strategy === "fallback" || strategy === "parallel");
    if (!useSerper && strategy === "serper") {
        console.warn("[web-search] SERPER_API_KEY not set; downgrading strategy to exa.");
    }
    const exaProvider = getProvider("exa");
    const serperProvider = getProvider("serper");
    // Basic single-provider strategies (exa default, or Serper strategies downgraded without key)
    if (strategy === "exa" || !useSerper) {
        if (!exaProvider) {
            return { results: [], providerUsed: "none" };
        }
        const results = await executeWithProvider(subQueries, exaProvider);
        return {
            results,
            providerUsed: hasExaKey ? "exa" : "none",
        };
    }
    if (strategy === "serper") {
        if (!serperProvider) {
            return { results: [], providerUsed: "none" };
        }
        const results = await executeWithProvider(subQueries, serperProvider);
        return { results, providerUsed: "serper" };
    }
    // Fallback: try Serper first, then Exa if Serper yields nothing
    if (strategy === "fallback") {
        if (!serperProvider) {
            console.warn("[web-search] Serper provider not available; using Exa only.");
            if (!exaProvider) {
                return { results: [], providerUsed: "none" };
            }
            const results = await executeWithProvider(subQueries, exaProvider);
            return {
                results,
                providerUsed: hasExaKey ? "exa" : "none",
            };
        }
        const primaryResults = await executeWithProvider(subQueries, serperProvider);
        if (primaryResults.length > 0) {
            return { results: primaryResults, providerUsed: "serper" };
        }
        console.warn("[web-search] Serper returned no results for all sub-queries, falling back to Exa.");
        if (!exaProvider) {
            return { results: [], providerUsed: "none" };
        }
        const fallbackResults = await executeWithProvider(subQueries, exaProvider);
        return {
            results: fallbackResults,
            providerUsed: hasExaKey ? "exa" : "none",
        };
    }
    // Parallel: query both providers and merge results
    if (strategy === "parallel") {
        const providers = [];
        if (serperProvider)
            providers.push({ name: "serper", fn: serperProvider });
        if (exaProvider)
            providers.push({ name: "exa", fn: exaProvider });
        if (providers.length === 0) {
            return { results: [], providerUsed: "none" };
        }
        const resultsPerProvider = await Promise.all(providers.map(async (p) => ({
            name: p.name,
            results: await executeWithProvider(subQueries, p.fn),
        })));
        // First URL wins per provider order (Serper then Exa). Do not compare
        // `score` across providers — Exa and Serper use different scales.
        const byUrl = new Map();
        for (const { results } of resultsPerProvider) {
            for (const r of results) {
                const normalizedUrl = normalizeUrl(r.url);
                if (normalizedUrl && !byUrl.has(normalizedUrl)) {
                    byUrl.set(normalizedUrl, r);
                }
            }
        }
        const merged = [...byUrl.values()];
        let providerUsed;
        if (hasExaKey && hasSerperKey) {
            providerUsed = "exa+serper";
        }
        else if (hasSerperKey) {
            providerUsed = "serper";
        }
        else {
            providerUsed = "none";
        }
        return { results: merged, providerUsed };
    }
    // Fallback safety – should not reach here
    const defaultProvider = exaProvider ?? serperProvider;
    if (!defaultProvider) {
        return { results: [], providerUsed: "none" };
    }
    const defaultResults = await executeWithProvider(subQueries, defaultProvider);
    const providerUsed = defaultProvider === exaProvider ? (hasExaKey ? "exa" : "none") : "serper";
    return { results: defaultResults, providerUsed };
}
//# sourceMappingURL=web-search.js.map