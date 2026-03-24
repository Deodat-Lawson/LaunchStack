import type {
  MarketingPlatform,
  MarketingResearchResult,
} from "~/lib/tools/marketing-pipeline/types";
import { runTrendSearch } from "~/lib/tools/trend-search";
import { getCachedTrendSearch, setCachedTrendSearch } from "~/lib/tools/trend-search/cache";

export async function researchPlatformTrends(args: {
  platform: MarketingPlatform;
  prompt: string;
  companyName: string;
  companyContext: string;
  maxResults: number;
}): Promise<MarketingResearchResult[]> {
  const { platform, prompt, companyContext, maxResults } = args;

  try {
    const cached = getCachedTrendSearch(prompt, companyContext);
    const trendOutput = cached ?? (await runTrendSearch({
      query: prompt,
      companyContext,
      categories: undefined,
    }));

    if (!cached) {
      setCachedTrendSearch(prompt, companyContext, trendOutput);
    }

    const top = trendOutput.results.slice(0, maxResults);

    return top.map<MarketingResearchResult>((item) => ({
      title: item.summary?.trim() || "Untitled",
      url: item.sourceUrl,
      snippet: item.description?.trim() || item.summary?.trim() || "",
      // Keep the selected platform as source label so the UI
      // still groups results under the chosen channel.
      source: platform,
    }));
  } catch (error) {
    console.warn("[marketing-pipeline] trend search failed:", error);
    return [];
  }
}

