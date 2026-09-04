import { z } from "zod";

/** Search categories the query planners can target. */
export const SearchCategoryEnum = z.enum(["fashion", "finance", "business", "tech"]);
export type SearchCategory = z.infer<typeof SearchCategoryEnum>;

/**
 * One planned sub-query, produced by a caller's query planner.
 *
 * `category` is a free label (widened from the four-value enum in the
 * distribution design P0): trend-search keeps planning within
 * SearchCategoryEnum; other callers tag queries with their own vocabulary
 * ("distributor-directory", "brand-locator"). Nothing in this tool branches
 * on it — it is provenance for the caller.
 */
export interface PlannedQuery {
    searchQuery: string;
    category: SearchCategory | (string & {});
    rationale: string;
}

/** Normalized result shape shared by every provider. */
export interface RawSearchResult {
    url: string;
    title: string;
    content: string;
    score: number;
    publishedDate?: string;
}

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
