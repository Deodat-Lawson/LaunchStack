import { env } from "~/env";
import type { WebSearchResult } from "./types";

/**
 * Performs a web search using the Exa API (auto mode: hybrid neural + keyword).
 * @param query - The search query
 * @param maxResults - Maximum number of results to return (default: 5)
 * @returns Array of web search results
 */
export async function performExaSearch(
    query: string,
    maxResults = 5
): Promise<WebSearchResult[]> {
    if (!env.server.EXA_API_KEY) {
        console.warn('Exa API key not configured. Web search disabled.');
        return [];
    }

    try {
        const response = await fetch('https://api.exa.ai/search', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': env.server.EXA_API_KEY,
            },
            body: JSON.stringify({
                query,
                type: 'auto',
                numResults: maxResults,
                contents: {
                    text: true,
                },
            }),
        });

        if (!response.ok) {
            throw new Error(`Exa API error: ${response.statusText}`);
        }

        const data = (await response.json()) as {
            results?: Array<{
                title?: string;
                url?: string;
                text?: string;
            }>;
        };

        if (!data.results || !Array.isArray(data.results)) {
            return [];
        }

        return data.results
            .map((item) => ({
                title: item.title ?? 'Untitled',
                url: item.url ?? '',
                snippet: item.text ?? '',
            }))
            .filter((item) => item.url && item.title);
    } catch (error) {
        console.error('Exa search error:', error);
        return [];
    }
}
