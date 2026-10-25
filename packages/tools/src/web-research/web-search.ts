/**
 * Exa-first web search: the one place LaunchStack asks the web a question.
 *
 *  - `searchWeb` — one general web search, for chat, research and profiling.
 *    The providers under ./providers serve trend research and search *news*
 *    (Exa's news category, Serper's /news); everything else needs the whole
 *    web — a release page, a price, a company's own site — so this calls the
 *    vendors' general endpoints. Exa is the default; Serper is the fallback
 *    when it is the only key, or when SEARCH_PROVIDER says so.
 *  - `searchCompanies` — Exa's company index: homepages of organisations
 *    matching a description, for finding prospects. Exa only.
 *  - `describeCompanies` — one or two sentences on what each company sells
 *    and to whom, from its homepage (Exa contents), to search for lookalikes.
 *
 * All throw on failure so the caller can say the search failed rather than
 * that nothing exists.
 */

import { getExaApiKey, getSearchStrategyFromEnv, getSerperApiKey } from "./config";

export type WebSearchProviderName = "exa" | "serper";

export interface WebSearchHit {
    title: string;
    url: string;
    /** Page text (Exa) or the result snippet (Serper), cut to `snippetChars`. */
    snippet: string;
    publishedDate?: string;
}

export interface SearchWebOptions {
    /** Results to ask for (default 5, at most 10). */
    maxResults?: number;
    /** Characters of text kept per result (default 1200). */
    snippetChars?: number;
    /** Whole-request timeout (default 10 s). */
    timeoutMs?: number;
    signal?: AbortSignal;
    /** Injectable for tests; defaults to global fetch. */
    fetchImpl?: typeof fetch;
}

export interface WebSearchResponse {
    provider: WebSearchProviderName;
    results: WebSearchHit[];
}

const EXA_SEARCH_URL = "https://api.exa.ai/search";
const EXA_CONTENTS_URL = "https://api.exa.ai/contents";
const SERPER_SEARCH_URL = "https://google.serper.dev/search";

/** A result's title, or its URL when the provider gave none. */
function titleOf(title: string | undefined, url: string): string {
    // An empty title falls back too, which `??` would not do.
    const trimmed = title?.trim();
    if (trimmed) return trimmed;
    return url;
}

/** The provider a search would use now, or null when no search key is set. */
export function configuredWebSearchProvider(): WebSearchProviderName | null {
    const exa = Boolean(getExaApiKey());
    const serper = Boolean(getSerperApiKey());
    if (serper && getSearchStrategyFromEnv() === "serper") return "serper";
    if (exa) return "exa";
    if (serper) return "serper";
    return null;
}

function clip(text: string, chars: number): string {
    const flat = text.replace(/\s+/g, " ").trim();
    return flat.length > chars ? `${flat.slice(0, chars)}…` : flat;
}

async function postJson(
    url: string,
    headers: Record<string, string>,
    body: unknown,
    options: SearchWebOptions,
    vendor: string
): Promise<unknown> {
    const timeout = AbortSignal.timeout(options.timeoutMs ?? 10_000);
    const response = await (options.fetchImpl ?? fetch)(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
        signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
    });
    if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        // The status only: a vendor's error body is not shown to a model.
        throw new Error(`${vendor} search failed (HTTP ${response.status})`);
    }
    return response.json();
}

async function searchExa(
    apiKey: string,
    query: string,
    options: SearchWebOptions
): Promise<WebSearchHit[]> {
    const maxResults = Math.min(options.maxResults ?? 5, 10);
    const snippetChars = options.snippetChars ?? 1200;
    const data = (await postJson(
        EXA_SEARCH_URL,
        { "x-api-key": apiKey },
        {
            query,
            type: "auto",
            numResults: maxResults,
            contents: { text: { maxCharacters: snippetChars } },
        },
        options,
        "Exa"
    )) as {
        results?: Array<{ title?: string; url?: string; text?: string; publishedDate?: string }>;
    };
    return (data.results ?? [])
        .filter(item => typeof item.url === "string" && item.url.length > 0)
        .slice(0, maxResults)
        .map(item => ({
            title: titleOf(item.title, item.url!),
            url: item.url!,
            snippet: clip(item.text ?? "", snippetChars),
            ...(item.publishedDate ? { publishedDate: item.publishedDate } : {}),
        }));
}

async function searchSerper(
    apiKey: string,
    query: string,
    options: SearchWebOptions
): Promise<WebSearchHit[]> {
    const maxResults = Math.min(options.maxResults ?? 5, 10);
    const data = (await postJson(
        SERPER_SEARCH_URL,
        { "X-API-KEY": apiKey },
        { q: query, num: maxResults },
        options,
        "Serper"
    )) as {
        organic?: Array<{ title?: string; link?: string; snippet?: string; date?: string }>;
    };
    return (data.organic ?? [])
        .filter(item => typeof item.link === "string" && item.link.length > 0)
        .slice(0, maxResults)
        .map(item => ({
            title: titleOf(item.title, item.link!),
            url: item.link!,
            snippet: clip(item.snippet ?? "", options.snippetChars ?? 1200),
            ...(item.date ? { publishedDate: item.date } : {}),
        }));
}

/** Search the web with the configured provider. Throws when none is configured. */
export async function searchWeb(
    query: string,
    options: SearchWebOptions = {}
): Promise<WebSearchResponse> {
    const provider = configuredWebSearchProvider();
    if (provider === "serper") {
        return {
            provider,
            results: await searchSerper(getSerperApiKey()!, query, options),
        };
    }
    if (provider === "exa") {
        return { provider, results: await searchExa(getExaApiKey()!, query, options) };
    }
    throw new Error("No web search provider is configured (set EXA_API_KEY or SERPER_API_KEY).");
}

// ── Companies (Exa only) ────────────────────────────────────────────────────

export interface CompanySearchOptions
    extends Omit<SearchWebOptions, "maxResults" | "snippetChars"> {
    /** Companies to ask for (default 10, at most 25; Exa bills each one past 10). */
    maxResults?: number;
    /** Two-letter country code: Exa ranks companies there first. */
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

/** Whether company search (and lookalikes, which are built on it) can run: it needs an Exa key. */
export function companySearchAvailable(): boolean {
    return Boolean(getExaApiKey());
}

function domainOf(url: string): string | null {
    try {
        return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    } catch {
        return null;
    }
}

/** Exa refuses more than 1,200 domains; the most recent exclusions are dropped first. */
const MAX_EXCLUDED_DOMAINS = 1_200;

function exaApiKey(): string {
    const apiKey = getExaApiKey();
    if (!apiKey) throw new Error("Company search needs an Exa key (set EXA_API_KEY).");
    return apiKey;
}

/**
 * Organisations whose homepages match `query` ("produce wholesalers in
 * Houston"), from Exa's company index. Excluded hosts never come back, and
 * each company appears once.
 */
export async function searchCompanies(
    query: string,
    options: CompanySearchOptions = {}
): Promise<CompanyHit[]> {
    const apiKey = exaApiKey();
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
    const data = (await postJson(
        EXA_SEARCH_URL,
        { "x-api-key": apiKey },
        {
            query,
            type: "auto",
            category: "company",
            numResults: maxResults,
            ...(country && /^[A-Z]{2}$/.test(country) ? { userLocation: country } : {}),
            ...(excluded.length > 0 ? { excludeDomains: excluded } : {}),
            contents: { text: { maxCharacters: descriptionChars } },
        },
        { ...options, timeoutMs: options.timeoutMs ?? 20_000 },
        "Exa company"
    )) as { results?: Array<{ title?: string; url?: string; text?: string }> };

    const skip = new Set(excluded);
    const seen = new Set<string>();
    const hits: CompanyHit[] = [];
    for (const item of data.results ?? []) {
        if (typeof item.url !== "string" || !item.url) continue;
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

export interface CompanyDescription {
    url: string;
    domain: string;
    title: string;
    /** What the company sells and to whom, in a sentence or two. */
    description: string;
}

const DESCRIBE_PROMPT =
    "In one or two sentences: what does this company sell, and to which kind of customer?";

/**
 * What each company does, read from its homepage by Exa (a short summary,
 * falling back to the start of the page text). Pages Exa cannot read are
 * left out. Used to search for companies like a known customer.
 */
export async function describeCompanies(
    urls: readonly string[],
    options: Omit<SearchWebOptions, "maxResults" | "snippetChars"> = {}
): Promise<CompanyDescription[]> {
    const wanted = [...new Set(urls.map(u => u.trim()).filter(Boolean))].slice(0, 100);
    if (wanted.length === 0) return [];
    const apiKey = exaApiKey();
    const data = (await postJson(
        EXA_CONTENTS_URL,
        { "x-api-key": apiKey },
        {
            urls: wanted,
            summary: { query: DESCRIBE_PROMPT },
            text: { maxCharacters: 400 },
        },
        { ...options, timeoutMs: options.timeoutMs ?? 30_000 },
        "Exa contents"
    )) as { results?: Array<{ url?: string; title?: string; summary?: string; text?: string }> };

    const described: CompanyDescription[] = [];
    for (const item of data.results ?? []) {
        if (typeof item.url !== "string" || !item.url) continue;
        const domain = domainOf(item.url);
        const description = clip(item.summary?.trim() || item.text || "", 400);
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
