import type {
  PlannedQuery,
  RawSearchResult,
} from "./types";
import { providerRegistry } from "./providers/registry";
import type {
  ProviderStrategy,
  SearchExecutionResult,
  SearchProviderFn,
  SearchProviderUsed,
} from "./providers/types";

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
async function runSubQueryWithRetry(
  query: string,
  provider: SearchProviderFn,
): Promise<RawSearchResult[]> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await provider(query);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < MAX_RETRIES) {
        console.warn(
          `[web-search] Sub-query failed (attempt ${
            attempt + 1
          }/${MAX_RETRIES + 1}): "${query.slice(0, 50)}..."`,
          lastError.message,
        );
      } else {
        console.error(
          `[web-search] Sub-query failed after ${
            MAX_RETRIES + 1
          } attempts: "${query.slice(0, 50)}..."`,
          lastError,
        );
      }
    }
  }

  if (lastError) return [];

  console.warn(
    `[web-search] Zero results for sub-query: "${query.slice(0, 80)}..."`,
  );
  return [];
}

async function executeWithProvider(
  subQueries: PlannedQuery[],
  provider: SearchProviderFn,
): Promise<RawSearchResult[]> {
  const perQueryResults = await Promise.all(
    subQueries.map((sub) => runSubQueryWithRetry(sub.searchQuery, provider)),
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

function resolveStrategy(
  override?: ProviderStrategy,
): ProviderStrategy {
  if (override) return override;

  const fromEnv = process.env.SEARCH_PROVIDER;
  if (
    fromEnv === "serper" ||
    fromEnv === "fallback" ||
    fromEnv === "parallel"
  ) {
    return fromEnv;
  }
  return "tavily";
}

function getProvider(name: string): SearchProviderFn | null {
  const provider = providerRegistry[name];
  if (!provider) {
    console.warn(`[web-search] Unknown provider "${name}", skipping.`);
    return null;
  }
  return provider;
}

export async function executeSearch(
  subQueries: PlannedQuery[],
  strategyOverride?: ProviderStrategy,
): Promise<SearchExecutionResult> {
  const strategy = resolveStrategy(strategyOverride);

  const hasTavilyKey = Boolean(process.env.TAVILY_API_KEY);
  const hasSerperKey = Boolean(process.env.SERPER_API_KEY);

  const useSerper =
    hasSerperKey &&
    (strategy === "serper" ||
      strategy === "fallback" ||
      strategy === "parallel");

  if (!useSerper && strategy === "serper") {
    console.warn(
      "[web-search] SERPER_API_KEY not set; downgrading strategy to tavily.",
    );
  }

  const tavilyProvider = getProvider("tavily");
  const serperProvider = getProvider("serper");

  // Basic single-provider strategies (tavily default, or Serper strategies downgraded without key)
  if (strategy === "tavily" || !useSerper) {
    if (!tavilyProvider) {
      return { results: [], providerUsed: "none" };
    }
    const results = await executeWithProvider(subQueries, tavilyProvider);
    return {
      results,
      providerUsed: hasTavilyKey ? "tavily" : "none",
    };
  }

  if (strategy === "serper") {
    if (!serperProvider) {
      return { results: [], providerUsed: "none" };
    }
    const results = await executeWithProvider(subQueries, serperProvider);
    return { results, providerUsed: "serper" };
  }

  // Fallback: try Serper first, then Tavily if Serper yields nothing
  if (strategy === "fallback") {
    if (!serperProvider) {
      console.warn(
        "[web-search] Serper provider not available; using Tavily only.",
      );
      if (!tavilyProvider) {
        return { results: [], providerUsed: "none" };
      }
      const results = await executeWithProvider(subQueries, tavilyProvider);
      return {
        results,
        providerUsed: hasTavilyKey ? "tavily" : "none",
      };
    }

    const primaryResults = await executeWithProvider(
      subQueries,
      serperProvider,
    );
    if (primaryResults.length > 0) {
      return { results: primaryResults, providerUsed: "serper" };
    }

    console.warn(
      "[web-search] Serper returned no results for all sub-queries, falling back to Tavily.",
    );
    if (!tavilyProvider) {
      return { results: [], providerUsed: "none" };
    }

    const fallbackResults = await executeWithProvider(
      subQueries,
      tavilyProvider,
    );
    return {
      results: fallbackResults,
      providerUsed: hasTavilyKey ? "tavily" : "none",
    };
  }

  // Parallel: query both providers and merge results
  if (strategy === "parallel") {
    const providers: Array<{ name: string; fn: SearchProviderFn }> = [];
    if (serperProvider) providers.push({ name: "serper", fn: serperProvider });
    if (tavilyProvider) providers.push({ name: "tavily", fn: tavilyProvider });

    if (providers.length === 0) {
      return { results: [], providerUsed: "none" };
    }

    const resultsPerProvider = await Promise.all(
      providers.map(async (p) => ({
        name: p.name,
        results: await executeWithProvider(subQueries, p.fn),
      })),
    );

    // First URL wins per provider order (Serper then Tavily). Do not compare
    // `score` across providers — Tavily and Serper use different scales.
    const byUrl = new Map<string, RawSearchResult>();

    for (const { results } of resultsPerProvider) {
      for (const r of results) {
        const normalizedUrl = normalizeUrl(r.url);
        if (normalizedUrl && !byUrl.has(normalizedUrl)) {
          byUrl.set(normalizedUrl, r);
        }
      }
    }

    const merged: RawSearchResult[] = [...byUrl.values()];

    let providerUsed: SearchProviderUsed;
    if (hasTavilyKey && hasSerperKey) {
      providerUsed = "tavily+serper";
    } else if (hasSerperKey) {
      providerUsed = "serper";
    } else {
      providerUsed = "none";
    }

    return { results: merged, providerUsed };
  }

  // Fallback safety – should not reach here
  const defaultProvider = tavilyProvider ?? serperProvider;
  if (!defaultProvider) {
    return { results: [], providerUsed: "none" };
  }
  const defaultResults = await executeWithProvider(subQueries, defaultProvider);
  const providerUsed: SearchProviderUsed =
    defaultProvider === tavilyProvider
      ? hasTavilyKey
        ? "tavily"
        : "none"
      : "serper";
  return { results: defaultResults, providerUsed };
}
