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

/** Normalized result shape of `executeSearch` (news search for trend research). */
export interface RawSearchResult {
    url: string;
    title: string;
    content: string;
    score: number;
    publishedDate?: string;
}

// ── Providers ───────────────────────────────────────────────────────────────

/** The search engines LaunchStack can use; SEARCH_PROVIDER names one. */
export const SEARCH_PROVIDER_IDS = ["exa", "serper", "brave", "tavily", "searxng"] as const;
export type SearchProviderId = (typeof SEARCH_PROVIDER_IDS)[number];

/** Which provider served `executeSearch`; "none" when search is off. */
export type SearchProviderUsed = SearchProviderId | "none";

/** Extended result from executeSearch, includes which provider was used. */
export interface SearchExecutionResult {
    results: RawSearchResult[];
    providerUsed: SearchProviderUsed;
}

/** One web search result, the same shape from every provider. */
export interface WebSearchHit {
    title: string;
    url: string;
    /** Page text or the result's snippet, whichever the provider returns, cut to `snippetChars`. */
    snippet: string;
    publishedDate?: string;
}

export interface RequestOptions {
    /** Whole-request timeout (default 10 s). */
    timeoutMs?: number;
    signal?: AbortSignal;
    /** Injectable for tests; defaults to global fetch. */
    fetchImpl?: typeof fetch;
}

export interface SearchWebOptions extends RequestOptions {
    /** Results to ask for (default 5, at most 10). */
    maxResults?: number;
    /** Characters of text kept per result (default 1200). */
    snippetChars?: number;
}

/** "web" is the whole web; "news" is each engine's news search (trend research). */
export type SearchKind = "web" | "news";

export interface ProviderSearchOptions extends RequestOptions {
    kind: SearchKind;
    maxResults: number;
    snippetChars: number;
}

export interface CompanySearchOptions extends RequestOptions {
    /** Companies to ask for (default 10, at most 25; Exa bills each one past 10). */
    maxResults?: number;
    /** Two-letter country code: companies there rank first. */
    country?: string;
    /** Hosts never returned: existing customers, excluded companies, the seeds themselves. */
    excludeDomains?: readonly string[];
    /** Characters of homepage text kept per company (default 600). */
    descriptionChars?: number;
}

export interface CompanyHit {
    /** The homepage's title, which usually starts with the company's name. */
    title: string;
    url: string;
    /** Host without `www.`. */
    domain: string;
    /** The start of the homepage text. */
    description: string;
}

export interface CompanyDescription {
    url: string;
    domain: string;
    title: string;
    /** What the company sells and to whom, in a sentence or two. */
    description: string;
}

/** An index of companies rather than pages (Exa has one; the others don't). */
export interface CompanyIndex {
    search(query: string, options: CompanySearchOptions): Promise<CompanyHit[]>;
    /** Pages it cannot read are left out. `urls` is already de-duplicated and non-empty. */
    describe(urls: readonly string[], options: RequestOptions): Promise<CompanyDescription[]>;
}

/**
 * A search engine. Every provider answers web and news searches in the same
 * shape; one with a company index also finds and describes companies.
 * Implementations throw on a failed request (status only, never the vendor's
 * error body, which could reach a model).
 */
export interface SearchProvider {
    readonly id: SearchProviderId;
    /** Its name on screen: "Exa", "Brave Search". */
    readonly label: string;
    /** The setting that configures it: an API key, or SearXNG's address. */
    readonly credential: string;
    isConfigured(): boolean;
    search(query: string, options: ProviderSearchOptions): Promise<WebSearchHit[]>;
    readonly companies?: CompanyIndex;
}
