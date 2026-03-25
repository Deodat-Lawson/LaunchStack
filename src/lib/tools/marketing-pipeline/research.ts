import type {
  MarketingPlatform,
  MarketingResearchResult,
} from "~/lib/tools/marketing-pipeline/types";
import type { PlannedQuery } from "~/lib/tools/trend-search";
import { runTrendSearch } from "~/lib/tools/trend-search";
import { getCachedTrendSearch, setCachedTrendSearch } from "~/lib/tools/trend-search/cache";

function buildTrendQueries(
  platform: MarketingPlatform,
  companyName: string,
  prompt: string,
  companyIndustry?: string,
): PlannedQuery[] {
  const year = new Date().getFullYear();
  const industryHint = companyIndustry ? ` ${companyIndustry}` : "";

  return [
    {
      searchQuery: `${platform} marketing trends ${year}${industryHint} ${prompt}`,
      category: "business" as const,
      rationale: "Platform-specific trends for the campaign in this industry",
    },
    {
      searchQuery: `${industryHint || companyName} ${platform} content strategy best practices ${year}`,
      category: "tech" as const,
      rationale: "Industry-relevant content strategy trends",
    },
    {
      searchQuery: `${platform} engagement strategies${industryHint} ${prompt} ${year}`,
      category: "business" as const,
      rationale: "Engagement tactics for the target platform in this industry",
    },
  ];
}

export async function researchPlatformTrends(args: {
  platform: MarketingPlatform;
  prompt: string;
  companyName: string;
  companyContext: string;
  companyIndustry?: string;
  maxResults: number;
}): Promise<MarketingResearchResult[]> {
  const { platform, prompt, companyName, companyContext, companyIndustry, maxResults } = args;

  try {
    const cached = getCachedTrendSearch(prompt, companyContext);
    const preBuiltQueries = buildTrendQueries(platform, companyName, prompt, companyIndustry);
    const trendOutput = cached ?? (await runTrendSearch(
      { query: prompt, companyContext, categories: undefined },
      { preBuiltQueries },
    ));

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

