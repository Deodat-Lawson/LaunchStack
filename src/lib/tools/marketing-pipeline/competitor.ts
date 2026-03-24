import { createHash } from "node:crypto";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { executeSearch } from "~/lib/tools/trend-search/web-search";
import type { PlannedQuery } from "~/lib/tools/trend-search/types";
import { getChatModel, MARKETING_MODELS } from "~/lib/models";
import type { CompetitorAnalysis } from "~/lib/tools/marketing-pipeline/types";
import { CompetitorAnalysisSchema } from "~/lib/tools/marketing-pipeline/types";

/* ──────────────────────────────────────────────────────────────
 * In-memory cache — competitor landscape changes slowly.
 * ────────────────────────────────────────────────────────────── */

const COMPETITOR_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CompetitorCacheEntry {
  result: CompetitorAnalysis;
  expiresAt: number;
}

const cache = new Map<string, CompetitorCacheEntry>();

function buildCacheKey(companyName: string, categories: string[]): string {
  const normalized = `${companyName.trim().toLowerCase()}::${[...categories].sort().join(",").toLowerCase()}`;
  return createHash("sha256").update(normalized).digest("hex");
}

function pruneCache(): void {
  const now = Date.now();
  for (const [key, entry] of cache.entries()) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
}

function getCached(companyName: string, categories: string[]): CompetitorAnalysis | null {
  const key = buildCacheKey(companyName, categories);
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.result;
}

function setCache(companyName: string, categories: string[], result: CompetitorAnalysis): void {
  if (cache.size > 50) pruneCache();
  const key = buildCacheKey(companyName, categories);
  cache.set(key, { result, expiresAt: Date.now() + COMPETITOR_CACHE_TTL_MS });
}

/* ──────────────────────────────────────────────────────────────
 * Search query builder
 * ────────────────────────────────────────────────────────────── */

function buildCompetitorQueries(companyName: string, categories: string[]): PlannedQuery[] {
  const categoryStr = categories.length > 0 ? categories.join(" ") : "industry";
  const currentYear = new Date().getFullYear();
  return [
    {
      searchQuery: `${companyName} competitors ${categoryStr} positioning ${currentYear}`,
      category: "business",
      rationale: "Find direct competitors and their positioning",
    },
    {
      searchQuery: `${categoryStr} market leaders alternative solutions ${currentYear}`,
      category: "business",
      rationale: "Find alternatives and market leaders",
    },
  ];
}

/* ──────────────────────────────────────────────────────────────
 * Main competitor analysis
 * ────────────────────────────────────────────────────────────── */

export async function analyzeCompetitors(args: {
  companyName: string;
  categories: string[];
  companyContext?: string;
}): Promise<CompetitorAnalysis> {
  const { companyName, categories, companyContext = "" } = args;

  const cached = getCached(companyName, categories);
  if (cached) {
    console.log("[marketing-pipeline] competitor analysis cache HIT for %s", companyName);
    return cached;
  }

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

  const result = CompetitorAnalysisSchema.parse(response);
  setCache(companyName, categories, result);
  return result;
}
