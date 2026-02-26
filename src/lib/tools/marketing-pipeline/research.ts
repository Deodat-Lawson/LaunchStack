import { env } from "~/env";
import type { MarketingPlatform, MarketingResearchResult } from "~/lib/tools/marketing-pipeline/types";

const TAVILY_SEARCH_URL = "https://api.tavily.com/search";

interface TavilyResultItem {
    title?: string;
    url?: string;
    content?: string;
}

interface TavilySearchResponse {
    results?: TavilyResultItem[];
}

function buildPlatformQuery(platform: MarketingPlatform, prompt: string, companyName: string): string {
    const base = `${companyName} ${prompt} trending topic campaign`;
    switch (platform) {
        case "x":
            return `${base} site:x.com`;
        case "linkedin":
            return `${base} site:linkedin.com`;
        case "reddit":
            return `${base} site:reddit.com`;
        default:
            return base;
    }
}

async function callTavily(query: string, maxResults: number): Promise<TavilyResultItem[]> {
    const apiKey = env.server.TAVILY_API_KEY;
    if (!apiKey) {
        return [];
    }

    const response = await fetch(TAVILY_SEARCH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            api_key: apiKey,
            query,
            search_depth: "advanced",
            max_results: maxResults,
            topic: "news",
        }),
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Tavily API error: ${response.status} ${response.statusText} - ${text}`);
    }

    const data = (await response.json()) as TavilySearchResponse;
    return data.results ?? [];
}

export async function researchPlatformTrends(args: {
    platform: MarketingPlatform;
    prompt: string;
    companyName: string;
    maxResults: number;
}): Promise<MarketingResearchResult[]> {
    const { platform, prompt, companyName, maxResults } = args;
    const query = buildPlatformQuery(platform, prompt, companyName);
    const results = await callTavily(query, maxResults);

    return results
        .filter((item): item is Required<Pick<TavilyResultItem, "url">> & TavilyResultItem => Boolean(item.url))
        .map((item) => ({
            title: item.title?.trim() || "Untitled",
            url: item.url,
            snippet: item.content?.trim().slice(0, 500) || "No snippet available",
            source: platform,
        }));
}

