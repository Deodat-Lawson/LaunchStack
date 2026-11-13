/** Serper: Google results (organic web, or Google News) with short snippets. */

import { getSerperApiKey } from "../config";
import type { SearchProvider } from "../types";
import { clip, requestJson, searchBilling, titleOf, withUrl } from "./http";

const SERPER_SEARCH_URL = "https://google.serper.dev/search";
const SERPER_NEWS_URL = "https://google.serper.dev/news";

interface SerperItem {
    title?: string;
    link?: string;
    snippet?: string;
    date?: string;
}

export const serper: SearchProvider = {
    id: "serper",
    label: "Serper",
    credential: "SERPER_API_KEY",
    isConfigured: () => Boolean(getSerperApiKey()),
    async search(query, options) {
        const apiKey = getSerperApiKey();
        if (!apiKey) throw new Error("Serper search needs SERPER_API_KEY.");
        const news = options.kind === "news";
        const data = (await requestJson(
            news ? SERPER_NEWS_URL : SERPER_SEARCH_URL,
            {
                method: "POST",
                headers: { "X-API-KEY": apiKey },
                // News keeps the US/English edition trend research has always read.
                body: news
                    ? { q: query, num: options.maxResults, gl: "us", hl: "en" }
                    : { q: query, num: options.maxResults },
            },
            options,
            "Serper",
            searchBilling("serper")
        )) as { organic?: SerperItem[]; news?: SerperItem[] };
        const items = (news ? data.news : data.organic) ?? [];
        return withUrl(items.map(item => ({ ...item, url: item.link })))
            .slice(0, options.maxResults)
            .map(item => ({
                title: titleOf(item.title, item.url),
                url: item.url,
                snippet: clip(item.snippet ?? "", options.snippetChars),
                ...(item.date ? { publishedDate: item.date } : {}),
            }));
    },
};
