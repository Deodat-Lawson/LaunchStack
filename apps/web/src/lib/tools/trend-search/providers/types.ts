import type { RawSearchResult } from "~/lib/tools/trend-search/types";

/** A search provider function: takes a query string, returns normalized results. */
export type SearchProviderFn = (query: string) => Promise<RawSearchResult[]>;

/** The supported provider strategy names. */
export type ProviderStrategy = "tavily" | "serper" | "fallback" | "parallel";

/** Which provider(s) produced the merged result (see `executeSearch`). */
export type SearchProviderUsed =
  | "tavily"
  | "serper"
  | "tavily (fallback)"
  | "tavily+serper"
  | "none"
  | "auto";

/** Extended result from executeSearch, includes which provider was used. */
export interface SearchExecutionResult {
  results: RawSearchResult[];
  providerUsed: SearchProviderUsed;
}
