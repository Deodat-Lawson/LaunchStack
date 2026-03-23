import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { executeSearch } from "~/lib/tools/trend-search/web-search";
import type { PlannedQuery } from "~/lib/tools/trend-search/types";
import { getChatModel, MARKETING_MODELS } from "~/lib/models";
import type { CompetitorAnalysis } from "~/lib/tools/marketing-pipeline/types";
import { CompetitorAnalysisSchema } from "~/lib/tools/marketing-pipeline/types";

/**
 * Build search queries to find competitor messaging and positioning.
 */
function buildCompetitorQueries(companyName: string, categories: string[]): PlannedQuery[] {
  const categoryStr = categories.length > 0 ? categories.join(" ") : "industry";
  return [
    {
      searchQuery: `${companyName} competitors ${categoryStr} positioning`,
      category: "business",
      rationale: "Find direct competitors and their positioning",
    },
    {
      searchQuery: `${categoryStr} market leaders alternative solutions 2025`,
      category: "business",
      rationale: "Find alternatives and market leaders",
    },
    {
      searchQuery: `${companyName} vs competitors comparison`,
      category: "business",
      rationale: "Find comparison content and differentiators",
    },
  ];
}

/**
 * Use web search + LLM to synthesize a competitor landscape for the company.
 */
export async function analyzeCompetitors(args: {
  companyName: string;
  categories: string[];
  companyContext?: string;
}): Promise<CompetitorAnalysis> {
  const { companyName, categories, companyContext = "" } = args;

  const plannedQueries = buildCompetitorQueries(companyName, categories);

  let rawContext = companyContext;
  try {
    const { results } = await executeSearch(plannedQueries);
    if (results.length > 0) {
      rawContext +=
        "\n\nWeb search results (competitors / market):\n" +
        results
          .slice(0, 12)
          .map(
            (r, i) =>
              `${i + 1}. [${r.title}] ${r.content.slice(0, 200)}... (${r.url})`,
          )
          .join("\n\n");
    }
  } catch (error) {
    console.warn("[marketing-pipeline] competitor web search failed:", error);
  }

  if (!rawContext.trim()) {
    rawContext = `Company: ${companyName}. Categories: ${categories.join(", ") || "Unknown"}. No search results.`;
  }

  const systemPrompt = `You are a competitive intelligence analyst. Given company name, categories, and optional web search results about competitors and the market, produce a structured CompetitorAnalysis.

Rules:
- Use ONLY information from the provided context and search results. Do not invent competitor names or quotes.
- If few or no results: return empty or short placeholder arrays and "Not enough data" style strings where needed.
- competitors: array of { name, positioning (1 sentence), weaknesses (1-3 short items) } for up to 5 competitors.
- ourAdvantages: 2-5 short phrases where our company clearly wins (infer from context or leave minimal).
- marketGaps: 2-4 opportunities competitors miss.
- messagingAntiPatterns: 2-4 clichés or messages competitors use that we should avoid.

Return valid JSON matching the schema.`;

  const chat = getChatModel(MARKETING_MODELS.competitorAnalysis);
  const model = chat.withStructuredOutput(CompetitorAnalysisSchema, {
    name: "competitor_analysis",
  });
  const response = await model.invoke([
    new SystemMessage(systemPrompt),
    new HumanMessage(rawContext),
  ]);

  return CompetitorAnalysisSchema.parse(response);
}
