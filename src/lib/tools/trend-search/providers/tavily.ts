import { env } from "~/env";
import type { RawSearchResult } from "~/lib/tools/trend-search/types";

const TAVILY_SEARCH_URL = "https://api.tavily.com/search";
const MAX_RESULTS_PER_QUERY = 10;

interface TavilyResultItem {
  title?: string;
  url?: string;
  content?: string;
  score?: number;
  published_date?: string;
}

interface TavilySearchResponse {
  results?: TavilyResultItem[];
}

/**
 * Calls Tavily search API for a single query with advanced depth and news topic.
 * @returns RawSearchResult[] or empty array on missing key / parse failure
 */
export async function callTavily(query: string): Promise<RawSearchResult[]> {
  const apiKey = env.server.TAVILY_API_KEY;
  if (!apiKey) {
    console.warn("[web-search] TAVILY_API_KEY not set; skipping Tavily search.");
    return [];
  }

  const response = await fetch(TAVILY_SEARCH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: "advanced",
      topic: "news",
      max_results: MAX_RESULTS_PER_QUERY,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Tavily API error: ${response.status} ${response.statusText} - ${text}`,
    );
  }

  const data = (await response.json()) as TavilySearchResponse;
  if (!data.results || !Array.isArray(data.results)) {
    return [];
  }

  return data.results
    .filter(
      (item): item is TavilyResultItem & { url: string } =>
        Boolean(item?.url),
    )
    .map((item) => ({
      url: item.url,
      title: item.title ?? "Untitled",
      content: item.content ?? "",
      score: typeof item.score === "number" ? item.score : 0,
      ...(item.published_date != null && { publishedDate: item.published_date }),
    }));
}

