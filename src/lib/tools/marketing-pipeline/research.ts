import { env } from "~/env";
import type { MarketingPlatform, MarketingResearchResult } from "~/lib/tools/marketing-pipeline/types";
import { redditClient } from "~/lib/tools/marketing-pipeline/clients/reddit";
import { twitterClient } from "~/lib/tools/marketing-pipeline/clients/twitter";
import { linkedinClient } from "~/lib/tools/marketing-pipeline/clients/linkedin";
import { blueskyClient } from "~/lib/tools/marketing-pipeline/clients/bluesky";

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
        case "bluesky":
            return `${base} site:bluesky.com`;
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

    try {
        // Try platform-specific API first
        let results: MarketingResearchResult[] = [];

        switch (platform) {
            case "reddit":
                results = await redditClient.searchTrendingPosts(
                    `${prompt} ${companyName}`, 
                    maxResults
                );
                break;
            
            case "x":
                results = await twitterClient.searchTrendingTweets(
                    `${prompt} ${companyName}`, 
                    maxResults
                );
                break;
            
            case "linkedin":
                results = await linkedinClient.searchTrendingPosts(
                    `${prompt} ${companyName}`, 
                    maxResults
                );
                break;

            case "bluesky":
                results = await blueskyClient.searchTrendingPosts(
                    `${prompt} ${companyName}`, 
                    maxResults
                );
                break;
        }

        // If we got good results from the platform API, return them
        if (results.length > 0) {
            return results;
        }

        // Fallback to web search if platform API failed or returned no results
        console.warn(`Platform API for ${platform} returned no results, falling back to web search`);
        return await fallbackWebSearch(platform, prompt, companyName, maxResults);

    } catch (error) {
        console.error(`Platform API error for ${platform}:`, error);
        
        // Fallback to web search on any error
        return await fallbackWebSearch(platform, prompt, companyName, maxResults);
    }
}

// Fallback function using the original Tavily web search
async function fallbackWebSearch(
    platform: MarketingPlatform, 
    prompt: string, 
    companyName: string, 
    maxResults: number
): Promise<MarketingResearchResult[]> {
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

