/**
 * SearXNG: a self-hosted metasearch engine, free and keyless. SEARXNG_URL is
 * the instance's address; the instance must allow the JSON format
 * (`search.formats` in its settings.yml), or it answers 403.
 * https://docs.searxng.org/dev/search_api.html
 */

import { getSearxngUrl } from "../config";
import type { SearchProvider } from "../types";
import { clip, requestJson, searchBilling, titleOf, withUrl } from "./http";

interface SearxngItem {
    title?: string;
    url?: string;
    content?: string;
    publishedDate?: string | null;
}

/** The instance's search endpoint, whether SEARXNG_URL names the root or `/search`. */
export function searxngSearchUrl(base: string): string {
    const root = base.replace(/\/+$/, "").replace(/\/search$/, "");
    return `${root}/search`;
}

export const searxng: SearchProvider = {
    id: "searxng",
    label: "SearXNG",
    credential: "SEARXNG_URL",
    isConfigured: () => Boolean(getSearxngUrl()),
    async search(query, options) {
        const base = getSearxngUrl();
        if (!base) throw new Error("SearXNG search needs SEARXNG_URL.");
        const params = new URLSearchParams({
            q: query,
            format: "json",
            categories: options.kind === "news" ? "news" : "general",
        });
        let data: { results?: SearxngItem[] };
        try {
            data = (await requestJson(
                `${searxngSearchUrl(base)}?${params}`,
                { method: "GET" },
                options,
                "SearXNG",
                // Free to run, but counted so usage shows it; its price is zero.
                searchBilling("searxng")
            )) as { results?: SearxngItem[] };
        } catch (error) {
            if (error instanceof Error && error.message.endsWith("(HTTP 403)")) {
                throw new Error(
                    "SearXNG search failed (HTTP 403): the instance does not allow format=json; add json to search.formats in its settings.yml."
                );
            }
            throw error;
        }
        return withUrl(data.results)
            .slice(0, options.maxResults)
            .map(item => ({
                title: titleOf(item.title, item.url),
                url: item.url,
                snippet: clip(item.content ?? "", options.snippetChars),
                ...(item.publishedDate ? { publishedDate: item.publishedDate } : {}),
            }));
    },
};
