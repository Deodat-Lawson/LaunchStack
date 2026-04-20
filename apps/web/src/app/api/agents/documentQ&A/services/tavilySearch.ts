import { env } from "~/env";
import type { WebSearchResult } from "./types";

/**
 * Performs a web search using the Tavily API
 * @param query - The search query
 * @param maxResults - Maximum number of results to return (default: 5)
 * @returns Array of web search results
 */
export async function performTavilySearch(
    query: string,
    maxResults = 5
): Promise<WebSearchResult[]> {
    // Return empty results if Tavily API key is not configured
    if (!env.server.TAVILY_API_KEY) {
        console.warn('Tavily API key not configured. Web search disabled.');
        return [];
    }

    try {
        const response = await fetch('https://api.tavily.com/search', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                api_key: env.server.TAVILY_API_KEY,
                query,
                max_results: maxResults,
                search_depth: "basic",
            }),
        });

        if (!response.ok) {
            throw new Error(`Tavily API error: ${response.statusText}`);
        }

        const data = (await response.json()) as {
            results?: Array<{
                title?: string;
                url?: string;
                content?: string;
            }>;
        };

        if (!data.results || !Array.isArray(data.results)) {
            return [];
        }

        return data.results
            .map((item) => ({
                title: item.title ?? 'Untitled',
                url: item.url ?? '',
                snippet: item.content ?? '',
            }))
            .filter((item) => item.url && item.title);
    } catch (error) {
        console.error('Tavily search error:', error);
        return [];
    }
}

