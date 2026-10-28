/**
 * Tavily: search built for AI agents; each result carries the relevant part
 * of the page. Basic depth costs one credit per request.
 * https://docs.tavily.com/documentation/api-reference/endpoint/search
 */

import { getTavilyApiKey } from "../config";
import type { SearchProvider } from "../types";
import { clip, requestJson, titleOf, withUrl } from "./http";

const TAVILY_SEARCH_URL = "https://api.tavily.com/search";

interface TavilyItem {
    title?: string;
    url?: string;
    content?: string;
    published_date?: string | null;
}

export const tavily: SearchProvider = {
    id: "tavily",
    label: "Tavily",
    credential: "TAVILY_API_KEY",
    isConfigured: () => Boolean(getTavilyApiKey()),
    async search(query, options) {
        const apiKey = getTavilyApiKey();
        if (!apiKey) throw new Error("Tavily search needs TAVILY_API_KEY.");
        const data = (await requestJson(
            TAVILY_SEARCH_URL,
            {
                method: "POST",
                headers: { Authorization: `Bearer ${apiKey}` },
                body: {
                    query,
                    topic: options.kind === "news" ? "news" : "general",
                    search_depth: "basic",
                    max_results: options.maxResults,
                },
            },
            options,
            "Tavily"
        )) as { results?: TavilyItem[] };
        return withUrl(data.results)
            .slice(0, options.maxResults)
            .map(item => ({
                title: titleOf(item.title, item.url),
                url: item.url,
                snippet: clip(item.content ?? "", options.snippetChars),
                ...(item.published_date ? { publishedDate: item.published_date } : {}),
            }));
    },
};
