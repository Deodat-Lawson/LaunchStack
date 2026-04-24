import type { RawSearchResult } from "../types";

/** A search provider function: takes a query string, returns normalized results. */
export type SearchProviderFn = (query: string) => Promise<RawSearchResult[]>;

/** The supported provider strategy names. */
export type ProviderStrategy = "exa" | "serper" | "fallback" | "parallel";

/** Which provider(s) produced the merged result (see `executeSearch`). */
export type SearchProviderUsed =
  | "exa"
  | "serper"
  | "exa (fallback)"
  | "exa+serper"
  | "none"
  | "auto";

/** Extended result from executeSearch, includes which provider was used. */
export interface SearchExecutionResult {
  results: RawSearchResult[];
  providerUsed: SearchProviderUsed;
}
