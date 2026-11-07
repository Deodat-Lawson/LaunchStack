/**
 * Brave Search API: an independent index. Web results carry a description
 * plus extra snippets; news has its own endpoint.
 * https://api-dashboard.search.brave.com/app/documentation/web-search
 */

import { getBraveSearchApiKey } from "../config";
import type { SearchProvider } from "../types";
import { clip, requestJson, searchBilling, stripTags, titleOf, withUrl } from "./http";

const BRAVE_WEB_URL = "https://api.search.brave.com/res/v1/web/search";
const BRAVE_NEWS_URL = "https://api.search.brave.com/res/v1/news/search";

interface BraveItem {
    title?: string;
    url?: string;
    description?: string;
    extra_snippets?: string[];
    page_age?: string;
}

export const brave: SearchProvider = {
    id: "brave",
    label: "Brave Search",
    credential: "BRAVE_SEARCH_API_KEY",
    isConfigured: () => Boolean(getBraveSearchApiKey()),
    async search(query, options) {
        const apiKey = getBraveSearchApiKey();
        if (!apiKey) throw new Error("Brave search needs BRAVE_SEARCH_API_KEY.");
        const news = options.kind === "news";
        const params = new URLSearchParams({ q: query, count: String(options.maxResults) });
        if (!news) params.set("extra_snippets", "true");
        const data = (await requestJson(
            `${news ? BRAVE_NEWS_URL : BRAVE_WEB_URL}?${params}`,
            { method: "GET", headers: { "X-Subscription-Token": apiKey } },
            options,
            "Brave",
            searchBilling("brave")
        )) as { web?: { results?: BraveItem[] }; results?: BraveItem[] };
        const items = news ? data.results : data.web?.results;
        return withUrl(items)
            .slice(0, options.maxResults)
            .map(item => ({
                title: titleOf(stripTags(item.title ?? ""), item.url),
                url: item.url,
                snippet: clip(
                    stripTags([item.description ?? "", ...(item.extra_snippets ?? [])].join(" ")),
                    options.snippetChars
                ),
                ...(item.page_age ? { publishedDate: item.page_age } : {}),
            }));
    },
};
