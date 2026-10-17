/**
 * searchWeb — one general web search, for an agent that decides when to search.
 *
 * The providers under ./providers serve trend research and search *news*
 * (Exa's news category, Serper's /news). A chat answer needs the whole web —
 * a release page, a price, a timetable — so this calls the same two vendors'
 * general endpoints. It picks whichever has a key (Exa first, Serper when
 * SEARCH_PROVIDER says so), and throws on failure so the calling tool can
 * tell the model the search failed rather than that nothing exists.
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
const SERPER_SEARCH_URL = "https://google.serper.dev/search";

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
            title: item.title?.trim() || item.url!,
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
            title: item.title?.trim() || item.link!,
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
