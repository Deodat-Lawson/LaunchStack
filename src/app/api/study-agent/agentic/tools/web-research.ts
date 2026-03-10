/**
 * Web Research Tool
 * Role: LangChain tool wrapper around Tavily search.
 * Purpose: enrich answers when docs lack coverage by fetching concise web snippets.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { performTavilySearch } from "~/app/api/agents/documentQ&A/services/tavilySearch";
import type { WebSearchResult } from "~/app/api/agents/documentQ&A/services/types";

const WebResearchSchema = z.object({
  query: z.string().describe("The search query for web research"),
  maxResults: z.number().min(1).max(10).default(5).describe("Maximum number of results to return"),
  searchType: z
    .enum(["general", "academic", "news"])
    .optional()
    .default("general")
    .describe("Type of search to perform"),
});

interface EnrichedWebResult extends WebSearchResult {
  relevanceScore?: number;
  summary?: string;
}

/**
 * Perform web research using Tavily
 */
export async function performWebResearch(
  query: string,
  maxResults = 5,
  searchType: "general" | "academic" | "news" = "general"
): Promise<{
  results: EnrichedWebResult[];
  summary: string;
}> {
  const startTime = Date.now();

  try {
    // Adjust query based on search type
    let adjustedQuery = query;
    if (searchType === "academic") {
      adjustedQuery = `academic research: ${query}`;
    } else if (searchType === "news") {
      adjustedQuery = `latest news: ${query}`;
    }

    const results = await performTavilySearch(adjustedQuery, maxResults);

    if (results.length === 0) {
      return {
        results: [],
        summary: "No relevant web results found for this query.",
      };
    }

    // Enrich results with additional metadata
    const enrichedResults: EnrichedWebResult[] = results.map((result, index) => ({
      ...result,
      relevanceScore: Math.round((1 - index * 0.1) * 100) / 100, // Decay by position
    }));

    // Generate summary
    const summary = `Found ${enrichedResults.length} relevant sources about "${query}". ${
      enrichedResults[0]?.title
        ? `Top result: "${enrichedResults[0].title}"`
        : ""
    }`;

    console.log(
      `🌐 [Web Research] Found ${enrichedResults.length} results for "${query}" in ${Date.now() - startTime}ms`
    );

    return {
      results: enrichedResults,
      summary,
    };
  } catch (error) {
    console.error("❌ [Web Research] Error:", error);
    throw error;
  }
}

/**
 * Web Research Tool for LangChain
 */
export const webResearchTool = tool(
  async (input): Promise<string> => {
    try {
      const { results, summary } = await performWebResearch(
        input.query,
        input.maxResults,
        input.searchType
      );

      return JSON.stringify({
        success: true,
        resultCount: results.length,
        results: results.map((r) => ({
          title: r.title,
          url: r.url,
          snippet: r.snippet?.substring(0, 300),
          relevanceScore: r.relevanceScore,
        })),
        summary,
        formattedForPrompt: results
          .map(
            (r, i) =>
              `[Source ${i + 1}] ${r.title}\nURL: ${r.url}\n${r.snippet}`
          )
          .join("\n\n"),
      });
    } catch (error) {
      return JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        results: [],
      });
    }
  },
  {
    name: "web_research",
    description:
      "Search the web for additional information, academic sources, or recent news. Use this to supplement document content when more information is needed or when documents don't contain the answer.",
    schema: WebResearchSchema,
  }
);

