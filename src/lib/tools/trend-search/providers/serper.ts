import { env } from "~/env";
import type { RawSearchResult } from "~/lib/tools/trend-search/types";

const SERPER_NEWS_URL = "https://google.serper.dev/news";
const MAX_RESULTS_PER_QUERY = 10;

/** Response shape from Serper Google News API (subset we use). */
interface SerperNewsItem {
    title?: string;
    link?: string;
    snippet?: string;
    date?: string;
    source?: string;
    position?: number;
}

interface SerperNewsResponse {
    news?: SerperNewsItem[];
}

/**
 * Calls Serper.dev Google News API for a single query.
 * @returns RawSearchResult[] or empty array if SERPER_API_KEY not set; throws on non-2xx.
 */
export async function callSerper(query: string): Promise<RawSearchResult[]> {
    const apiKey = env.server.SERPER_API_KEY;
    if (!apiKey) {
        console.warn("[web-search] SERPER_API_KEY not set; skipping Serper search.");
        return [];
    }

    const response = await fetch(SERPER_NEWS_URL, {
        method: "POST",
        headers: {
            "X-API-KEY": apiKey,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            q: query,
            num: MAX_RESULTS_PER_QUERY,
        }),
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Serper API error: ${response.status} ${response.statusText} - ${text}`);
    }

    const data = (await response.json()) as SerperNewsResponse;
    if (!data.news || !Array.isArray(data.news)) {
        return [];
    }

    const totalResults = data.news.length;
    return data.news
        .filter((item): item is SerperNewsItem & { link: string } => Boolean(item?.link))
        .map((item, index) => {
            const position = item.position ?? index + 1;
            const score = totalResults > 0 ? 1 - position / totalResults : 0;
            return {
                url: item.link,
                title: item.title ?? "Untitled",
                content: item.snippet ?? "",
                score,
                ...(item.date != null && item.date !== "" && { publishedDate: item.date }),
            };
        });
}
