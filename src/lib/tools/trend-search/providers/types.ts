import type { RawSearchResult } from "~/lib/tools/trend-search/types";

export type SearchProviderFn = (query: string) => Promise<RawSearchResult[]>;

export type ProviderStrategy = "tavily" | "serper" | "fallback" | "parallel";

export interface SearchExecutionResult {
  results: RawSearchResult[];
  providerUsed: string;
}

