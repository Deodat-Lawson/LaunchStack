import { env } from "~/env";
import type {
  PlannedQuery,
  RawSearchResult,
} from "~/lib/tools/trend-search/types";
import { providerRegistry } from "~/lib/tools/trend-search/providers/registry";
import type {
  ProviderStrategy,
  SearchExecutionResult,
  SearchProviderFn,
} from "~/lib/tools/trend-search/providers/types";

const MAX_RETRIES = 2;

/** Normalize URL for deduplication; falls back to trim if invalid. */
function normalizeUrl(url: string): string {
  try {
    return new URL(url).href;
  } catch {
    return url.trim();
  }
}

async function executeWithProvider(
  subQueries: PlannedQuery[],
  provider: SearchProviderFn,
): Promise<RawSearchResult[]> {
  const seenUrls = new Set<string>();
  const combined: RawSearchResult[] = [];

  for (const sub of subQueries) {
    const query = sub.searchQuery;
    let lastError: Error | null = null;
    let results: RawSearchResult[] = [];

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        results = await provider(query);
        lastError = null;
        break;
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

    if (results.length === 0 && lastError) {
      continue;
    }
    if (results.length === 0) {
      console.warn(
        `[web-search] Zero results for sub-query: "${query.slice(0, 80)}..."`,
      );
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

function resolveStrategy(
  override?: ProviderStrategy,
): ProviderStrategy {
  if (override) return override;

  const fromEnv = env.server.SEARCH_PROVIDER;
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

  const useSerper =
    env.server.SERPER_API_KEY &&
    (strategy === "serper" ||
      strategy === "fallback" ||
      strategy === "parallel");

  if (!useSerper && strategy === "serper") {
    console.warn(
      "[web-search] SERPER_API_KEY not set; falling back to Tavily strategy.",
    );
  }

  const tavilyProvider = getProvider("tavily");
  const serperProvider = getProvider("serper");

  // Basic single-provider strategies
  if (strategy === "tavily" || !useSerper) {
    if (!tavilyProvider) {
      return { results: [], providerUsed: "none" };
    }
    const results = await executeWithProvider(subQueries, tavilyProvider);
    return { results, providerUsed: "tavily" };
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
      return { results, providerUsed: "tavily" };
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
      return { results: [], providerUsed: "serper" };
    }

    const fallbackResults = await executeWithProvider(
      subQueries,
      tavilyProvider,
    );
    return {
      results: fallbackResults,
      providerUsed: "tavily (fallback)",
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

    const merged: RawSearchResult[] = [];
    const bestByUrl = new Map<string, RawSearchResult>();

    for (const { results } of resultsPerProvider) {
      for (const r of results) {
        const normalizedUrl = normalizeUrl(r.url);
        const existing = bestByUrl.get(normalizedUrl);
        if (!existing || r.score > existing.score) {
          bestByUrl.set(normalizedUrl, r);
        }
      }
    }

    for (const value of bestByUrl.values()) {
      merged.push(value);
    }

    return { results: merged, providerUsed: "tavily+serper" };
  }

  // Fallback safety – should not reach here
  const defaultProvider = tavilyProvider ?? serperProvider;
  if (!defaultProvider) {
    return { results: [], providerUsed: "none" };
  }
  const defaultResults = await executeWithProvider(subQueries, defaultProvider);
  return { results: defaultResults, providerUsed: "auto" };
}

