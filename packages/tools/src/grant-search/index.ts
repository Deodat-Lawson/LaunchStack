/**
 * grant-search — find open funding calls for a described organisation.
 *
 * Two sources behind one result: Grants.gov (federal, keyless, always
 * available) and the web (foundations, state programmes, corporate giving)
 * through the web-research tool when a search key is configured. Results
 * are listings — a title, a funder, dates and amounts where the source has
 * them — for a caller to score against what it knows about the applicant.
 * Nothing here calls a model.
 */
import { createTtlCache } from "../web-research/cache";
import { executeSearch, type RawSearchResult } from "../web-research";

import { getGrantsGovApiUrl, hasWebSearchKey, isGrantsGovEnabled } from "./config";
import { DEFAULT_LIMIT, MAX_LIMIT, searchGrantsGov, type GrantsGovOptions } from "./grants-gov";
import type {
    GrantOpportunity,
    GrantSearchQuery,
    GrantSearchResult,
    GrantSourceReport,
} from "./types";

export * from "./types";
export {
    buildSearchBody,
    keywordPhrase,
    opportunityUrl,
    parseOpportunityDetail,
    parseSearchResponse,
    plainText,
    searchGrantsGov,
    toIsoDay,
    type GrantsGovOptions,
} from "./grants-gov";
export { getGrantsGovApiUrl, hasWebSearchKey, isGrantsGovEnabled } from "./config";

export interface FindGrantsOptions {
    /** Injectable for tests; defaults to global fetch. */
    fetchImpl?: typeof fetch;
    signal?: AbortSignal;
    /** Web search over planned queries; injectable for tests. Null skips the web. */
    searchWeb?: ((queries: string[]) => Promise<RawSearchResult[]>) | null;
    grantsGovApiUrl?: string;
    now?: Date;
}

const cache = createTtlCache<GrantSearchResult>({ ttlMs: 10 * 60_000, maxEntries: 200 });

let cacheKeySalt = 0;

/** A fresh cache for the next search; the module-level one has no clear(). */
export function resetGrantSearchCache(): void {
    cacheKeySalt += 1;
}

/** Which sources a search will use in this environment. */
export function describeGrantSources(): { grantsGov: boolean; web: boolean } {
    return { grantsGov: isGrantsGovEnabled(), web: hasWebSearchKey() };
}

function hostOf(url: string): string {
    try {
        return new URL(url).hostname.replace(/^www\./, "");
    } catch {
        return url;
    }
}

/** The organisation half of a "Name | Tagline" page title, as the funder. */
function funderFromTitle(title: string, url: string): string {
    const tail = title
        .split(/\s[|–—-]\s/)
        .pop()
        ?.trim();
    if (tail && tail.length <= 60 && tail.toLowerCase() !== title.toLowerCase()) return tail;
    return hostOf(url);
}

/** Web queries that find grant listings rather than grant-writing advice. */
export function webQueriesFor(query: GrantSearchQuery): string[] {
    const focus = query.keywords
        .flatMap(k => k.split(","))
        .map(k => k.trim())
        .filter(Boolean)
        .slice(0, 4)
        .join(" ");
    if (!focus) return [];
    const who =
        query.applicantType === "nonprofit"
            ? "nonprofit"
            : query.applicantType === "small_business" || query.applicantType === "for_profit"
              ? "startup small business"
              : "";
    const where = query.geography?.trim() ?? "";
    const year = new Date().getUTCFullYear();
    return [
        `${focus} grant program ${who} ${where} apply ${year}`.replace(/\s+/g, " ").trim(),
        `${focus} foundation grants request for proposals ${where}`.replace(/\s+/g, " ").trim(),
        `${focus} funding opportunity ${who} deadline`.replace(/\s+/g, " ").trim(),
    ];
}

const LISTING_HINT =
    /\b(grant|grants|funding|fund|foundation|rfp|request for proposals|fellowship|prize|award)\b/i;

export function webResultToOpportunity(result: RawSearchResult): GrantOpportunity | null {
    const title = result.title?.trim();
    if (!title || !result.url) return null;
    if (!LISTING_HINT.test(`${title} ${result.content.slice(0, 300)}`)) return null;
    const content = result.content.replace(/\s+/g, " ").trim();
    return {
        source: "web",
        externalId: result.url,
        title,
        funder: funderFromTitle(title, result.url),
        url: result.url,
        summary: content ? content.slice(0, 600) : null,
        opensOn: null,
        closesOn: null,
        status: "unknown",
        amountMin: null,
        amountMax: null,
        eligibility: null,
        categories: [],
        opportunityNumber: null,
    };
}

/**
 * Find open grant opportunities. Sources run in parallel with allSettled
 * semantics: one failing is reported, not fatal; both failing yields an
 * empty list with both reports, which the caller may treat as a failure.
 */
export async function findGrants(
    query: GrantSearchQuery,
    options: FindGrantsOptions = {}
): Promise<GrantSearchResult> {
    const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const useGrantsGov = query.includeGrantsGov !== false && isGrantsGovEnabled();
    const searchWeb =
        options.searchWeb === undefined
            ? hasWebSearchKey()
                ? async (queries: string[]) =>
                      (
                          await executeSearch(
                              queries.map(searchQuery => ({
                                  searchQuery,
                                  category: "grant-listing",
                                  rationale: "grant search",
                              }))
                          )
                      ).results
                : null
            : options.searchWeb;
    const useWeb = query.includeWeb !== false && searchWeb !== null;

    const key = JSON.stringify({ query, limit, useGrantsGov, useWeb, salt: cacheKeySalt });
    const cached = cache.get(key);
    if (cached) return cached;

    const sources: GrantSourceReport[] = [];
    const opportunities: GrantOpportunity[] = [];

    const grantsGovOptions: GrantsGovOptions = {
        apiUrl: options.grantsGovApiUrl ?? getGrantsGovApiUrl(),
        fetchImpl: options.fetchImpl,
        signal: options.signal,
        now: options.now,
    };

    const [federal, web] = await Promise.allSettled([
        useGrantsGov
            ? searchGrantsGov({ ...query, limit }, grantsGovOptions)
            : Promise.resolve(null),
        useWeb && searchWeb ? searchWeb(webQueriesFor(query)) : Promise.resolve(null),
    ]);

    if (!useGrantsGov) {
        sources.push({ id: "grants_gov", status: "off", found: 0, detail: "disabled" });
    } else if (federal.status === "fulfilled" && federal.value) {
        opportunities.push(...federal.value.hits.slice(0, limit));
        sources.push({
            id: "grants_gov",
            status: "ok",
            found: federal.value.hits.length,
            detail:
                federal.value.total > federal.value.hits.length
                    ? `${federal.value.total} matched`
                    : null,
        });
    } else if (federal.status === "rejected") {
        sources.push({
            id: "grants_gov",
            status: "failed",
            found: 0,
            detail: federal.reason instanceof Error ? federal.reason.message : "request failed",
        });
    }

    if (!useWeb) {
        sources.push({
            id: "web",
            status: "off",
            found: 0,
            detail: query.includeWeb === false ? "skipped" : "no search key",
        });
    } else if (web.status === "fulfilled" && web.value) {
        const seen = new Set(opportunities.map(o => o.url));
        let found = 0;
        for (const result of web.value) {
            const opportunity = webResultToOpportunity(result);
            if (!opportunity || seen.has(opportunity.url)) continue;
            seen.add(opportunity.url);
            found++;
            if (found <= limit) opportunities.push(opportunity);
        }
        sources.push({ id: "web", status: "ok", found, detail: null });
    } else if (web.status === "rejected") {
        sources.push({
            id: "web",
            status: "failed",
            found: 0,
            detail: web.reason instanceof Error ? web.reason.message : "request failed",
        });
    }

    const result = { opportunities, sources };
    cache.set(key, result);
    return result;
}
