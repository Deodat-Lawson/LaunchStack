import type {
  MarketingPlatform,
  MarketingResearchResult,
} from "~/lib/tools/marketing-pipeline/types";
import { runTrendSearch } from "~/lib/tools/trend-search";

export async function researchPlatformTrends(args: {
  platform: MarketingPlatform;
  prompt: string;
  companyName: string;
  companyContext: string;
  maxResults: number;
}): Promise<MarketingResearchResult[]> {
  const { platform, prompt, companyContext, maxResults } = args;

  try {
    const trendOutput = await runTrendSearch({
      query: prompt,
      companyContext,
      // Categories are optional; let the planner infer from query + context for now.
      categories: undefined,
    });

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

