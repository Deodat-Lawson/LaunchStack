/**
 * SearchApi: Google results (organic web, or Google News) as structured JSON.
 * A query Google has no results for is a 200 without `organic_results`.
 * https://www.searchapi.io/docs/google
 */

import { getSearchApiApiKey } from "../config";
import type { SearchProvider } from "../types";
import { clip, requestJson, searchBilling, titleOf, withUrl } from "./http";

const SEARCHAPI_URL = "https://www.searchapi.io/api/v1/search";

interface SearchApiItem {
    title?: string;
    link?: string;
    snippet?: string;
    /** As Google shows it: "Oct 26, 2023", "15 hours ago". */
    date?: string;
    /** Google News only: the same date in ISO 8601. */
    iso_date?: string;
}

export const searchapi: SearchProvider = {
    id: "searchapi",
    label: "SearchApi",
    credential: "SEARCHAPI_API_KEY",
    isConfigured: () => Boolean(getSearchApiApiKey()),
    async search(query, options) {
        const apiKey = getSearchApiApiKey();
        if (!apiKey) throw new Error("SearchApi search needs SEARCHAPI_API_KEY.");
        const news = options.kind === "news";
        const params = new URLSearchParams({
            engine: news ? "google_news" : "google",
            q: query,
            num: String(options.maxResults),
        });
        // News keeps the US/English edition trend research has always read.
        if (news) {
            params.set("gl", "us");
            params.set("hl", "en");
        }
        const data = (await requestJson(
            `${SEARCHAPI_URL}?${params}`,
            { method: "GET", headers: { Authorization: `Bearer ${apiKey}` } },
            options,
            "SearchApi",
            searchBilling("searchapi")
        )) as { organic_results?: SearchApiItem[] };
        return withUrl(data.organic_results?.map(item => ({ ...item, url: item.link })))
            .slice(0, options.maxResults)
            .map(item => {
                const publishedDate = item.iso_date ?? item.date;
                return {
                    title: titleOf(item.title, item.url),
                    url: item.url,
                    snippet: clip(item.snippet ?? "", options.snippetChars),
                    ...(publishedDate ? { publishedDate } : {}),
                };
            });
    },
};
