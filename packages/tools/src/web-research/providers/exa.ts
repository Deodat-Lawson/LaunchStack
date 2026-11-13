/**
 * Exa: neural + keyword search with page text, a news category, and the only
 * company index among the providers (company search and lookalikes).
 */

import { getExaApiKey } from "../config";
import type {
    CompanyDescription,
    CompanyHit,
    CompanyIndex,
    CompanySearchOptions,
    RequestOptions,
    SearchProvider,
} from "../types";
import { clip, domainOf, requestJson, searchBilling, titleOf, withUrl } from "./http";

const EXA_SEARCH_URL = "https://api.exa.ai/search";
const EXA_CONTENTS_URL = "https://api.exa.ai/contents";

/** Exa refuses more than 1,200 domains; the most recent exclusions are dropped first. */
const MAX_EXCLUDED_DOMAINS = 1_200;

const DESCRIBE_PROMPT =
    "In one or two sentences: what does this company sell, and to which kind of customer?";

interface ExaItem {
    title?: string;
    url?: string;
    text?: string;
    summary?: string;
    publishedDate?: string;
}

function apiKey(): string {
    const key = getExaApiKey();
    if (!key) throw new Error("Exa search needs EXA_API_KEY.");
    return key;
}

/**
 * Organisations whose homepages match `query` ("produce wholesalers in
 * Houston"). Excluded hosts never come back, and each company appears once.
 */
async function searchCompanies(
    query: string,
    options: CompanySearchOptions
): Promise<CompanyHit[]> {
    const maxResults = Math.max(1, Math.min(options.maxResults ?? 10, 25));
    const descriptionChars = options.descriptionChars ?? 600;
    const excluded = [
        ...new Set(
            (options.excludeDomains ?? [])
                .map(d =>
                    d
                        .trim()
                        .toLowerCase()
                        .replace(/^www\./, "")
                )
                .filter(Boolean)
        ),
    ].slice(0, MAX_EXCLUDED_DOMAINS);
    const country = options.country?.trim().toUpperCase();
    const data = (await requestJson(
        EXA_SEARCH_URL,
        {
            method: "POST",
            headers: { "x-api-key": apiKey() },
            body: {
                query,
                type: "auto",
                category: "company",
                numResults: maxResults,
                ...(country && /^[A-Z]{2}$/.test(country) ? { userLocation: country } : {}),
                ...(excluded.length > 0 ? { excludeDomains: excluded } : {}),
                contents: { text: { maxCharacters: descriptionChars } },
            },
        },
        { ...options, timeoutMs: options.timeoutMs ?? 20_000 },
        "Exa company",
        searchBilling("exa")
    )) as { results?: ExaItem[] };

    const skip = new Set(excluded);
    const seen = new Set<string>();
    const hits: CompanyHit[] = [];
    for (const item of withUrl(data.results)) {
        const domain = domainOf(item.url);
        if (!domain || skip.has(domain) || seen.has(domain)) continue;
        seen.add(domain);
        hits.push({
            title: titleOf(item.title, item.url),
            url: item.url,
            domain,
            description: clip(item.text ?? "", descriptionChars),
        });
    }
    return hits.slice(0, maxResults);
}

/**
 * What each company does, read from its homepage (a short summary, falling
 * back to the start of the page text). Used to search for companies like a
 * known customer.
 */
async function describeCompanies(
    urls: readonly string[],
    options: RequestOptions
): Promise<CompanyDescription[]> {
    const data = (await requestJson(
        EXA_CONTENTS_URL,
        {
            method: "POST",
            headers: { "x-api-key": apiKey() },
            body: { urls, summary: { query: DESCRIBE_PROMPT }, text: { maxCharacters: 400 } },
        },
        { ...options, timeoutMs: options.timeoutMs ?? 30_000 },
        "Exa contents",
        // Exa bills the pages asked for, whether or not it could read them.
        { provider: "exa", kind: "web_contents", units: urls.length }
    )) as { results?: ExaItem[] };

    const described: CompanyDescription[] = [];
    for (const item of withUrl(data.results)) {
        const domain = domainOf(item.url);
        // An empty summary falls back to the page text too, which `??` would not do.
        let text = item.summary?.trim() ?? "";
        if (!text) text = item.text ?? "";
        const description = clip(text, 400);
        if (!domain || !description) continue;
        described.push({
            url: item.url,
            domain,
            title: titleOf(item.title, item.url),
            description,
        });
    }
    return described;
}

const companies: CompanyIndex = { search: searchCompanies, describe: describeCompanies };

export const exa: SearchProvider = {
    id: "exa",
    label: "Exa",
    credential: "EXA_API_KEY",
    isConfigured: () => Boolean(getExaApiKey()),
    async search(query, options) {
        const data = (await requestJson(
            EXA_SEARCH_URL,
            {
                method: "POST",
                headers: { "x-api-key": apiKey() },
                body: {
                    query,
                    type: "auto",
                    ...(options.kind === "news" ? { category: "news" } : {}),
                    numResults: options.maxResults,
                    contents: { text: { maxCharacters: options.snippetChars } },
                },
            },
            options,
            "Exa",
            searchBilling("exa")
        )) as { results?: ExaItem[] };
        return withUrl(data.results)
            .slice(0, options.maxResults)
            .map(item => ({
                title: titleOf(item.title, item.url),
                url: item.url,
                snippet: clip(item.text ?? "", options.snippetChars),
                ...(item.publishedDate ? { publishedDate: item.publishedDate } : {}),
            }));
    },
    companies,
};
