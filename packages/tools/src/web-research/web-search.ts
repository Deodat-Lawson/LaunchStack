/**
 * Web search: the one place LaunchStack asks the web a question. Every call
 * goes to the engine `SEARCH_PROVIDER` picks (see ./setup), so all features
 * use the same one.
 *
 *  - `searchWeb` — one general web search, for chat, research and profiling.
 *  - `searchCompanies` — organisations whose homepages match a description,
 *    for finding prospects. Needs a provider with a company index (Exa).
 *  - `describeCompanies` — one or two sentences on what each company sells
 *    and to whom, from its homepage, to search for lookalikes. Same index.
 *
 * News search for trend research is `executeSearch` in ./index.
 *
 * All throw on failure so the caller can say the search failed rather than
 * that nothing exists. Each request the engine answers is counted against the
 * current unit of work (`reportUsage`, in ./providers/http): a search, or the
 * pages Exa read.
 */

import { activeSearchProvider, resolveSearchSetup, searchOffReason } from "./setup";
import type {
    CompanyDescription,
    CompanyHit,
    CompanyIndex,
    CompanySearchOptions,
    RequestOptions,
    SearchProviderId,
    SearchWebOptions,
    WebSearchHit,
} from "./types";

/** @deprecated Kept for existing imports; the same thing as `SearchProviderId`. */
export type WebSearchProviderName = SearchProviderId;

export interface WebSearchResponse {
    provider: SearchProviderId;
    results: WebSearchHit[];
}

/** The provider a search would use now, or null when web search is off. */
export function configuredWebSearchProvider(): SearchProviderId | null {
    return activeSearchProvider()?.id ?? null;
}

/** Search the web with the configured provider. Throws when none is configured. */
export async function searchWeb(
    query: string,
    options: SearchWebOptions = {}
): Promise<WebSearchResponse> {
    const setup = resolveSearchSetup();
    const provider = setup.provider;
    if (!provider) throw new Error(searchOffReason(setup));
    const results = await provider.search(query, {
        kind: "web",
        maxResults: Math.max(1, Math.min(options.maxResults ?? 5, 10)),
        snippetChars: options.snippetChars ?? 1200,
        timeoutMs: options.timeoutMs,
        signal: options.signal,
        fetchImpl: options.fetchImpl,
    });
    return { provider: provider.id, results };
}

// ── Companies (a provider with a company index) ─────────────────────────────

/** Whether company search (and lookalikes, which are built on it) can run on the active provider. */
export function companySearchAvailable(): boolean {
    return Boolean(activeSearchProvider()?.companies);
}

function companyIndex(): CompanyIndex {
    const provider = activeSearchProvider();
    if (provider?.companies) return provider.companies;
    throw new Error(
        provider
            ? `Company search needs a provider with a company index; ${provider.label} has none (Exa does: SEARCH_PROVIDER=exa).`
            : searchOffReason()
    );
}

/**
 * Organisations whose homepages match `query` ("produce wholesalers in
 * Houston"). Excluded hosts never come back, and each company appears once.
 */
export async function searchCompanies(
    query: string,
    options: CompanySearchOptions = {}
): Promise<CompanyHit[]> {
    return companyIndex().search(query, options);
}

/**
 * What each company does, read from its homepage. Pages the provider cannot
 * read are left out. Used to search for companies like a known customer.
 */
export async function describeCompanies(
    urls: readonly string[],
    options: RequestOptions = {}
): Promise<CompanyDescription[]> {
    const wanted = [...new Set(urls.map(u => u.trim()).filter(Boolean))].slice(0, 100);
    if (wanted.length === 0) return [];
    return companyIndex().describe(wanted, options);
}
