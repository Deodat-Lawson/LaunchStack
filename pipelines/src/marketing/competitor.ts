import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { createTtlCache, executeSearch } from "@launchstack/tools/web-research";
import type { PlannedQuery } from "@launchstack/tools/web-research";
import { invokeMarketingStructured } from "./models";
import type { CompetitorAnalysis } from "./types";
import { CompetitorAnalysisSchema } from "./types";

/* ──────────────────────────────────────────────────────────────
 * In-memory cache — competitor landscape changes slowly.
 * ────────────────────────────────────────────────────────────── */

const COMPETITOR_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

const cache = createTtlCache<CompetitorAnalysis>({
    ttlMs: COMPETITOR_CACHE_TTL_MS,
    maxEntries: 50,
});

function buildCacheKey(companyName: string, categories: string[]): string {
    return `${companyName.trim().toLowerCase()}::${[...categories].sort().join(",").toLowerCase()}`;
}

/* ──────────────────────────────────────────────────────────────
 * Search query builder
 * ────────────────────────────────────────────────────────────── */

function buildCompetitorQueries(
    companyName: string,
    categories: string[],
    companyDescription?: string
): PlannedQuery[] {
    const categoryStr = categories.length > 0 ? categories.join(" ") : "industry";
    const currentYear = new Date().getFullYear();

    const descHint = companyDescription
        ? ` ${companyDescription.split(/\s+/).slice(0, 12).join(" ")}`
        : "";

    return [
        {
            searchQuery: `"${companyName}"${descHint} competitors ${categoryStr} ${currentYear}`,
            category: "business",
            rationale: "Find direct competitors using company description to disambiguate",
        },
        {
            searchQuery: `${categoryStr} market leaders alternative solutions ${currentYear}`,
            category: "business",
            rationale: "Find alternatives and market leaders in the same category",
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

    const cached = cache.get(buildCacheKey(companyName, categories));
    if (cached) {
        console.log("[marketing-pipeline] competitor analysis cache HIT for %s", companyName);
        return cached;
    }

    const plannedQueries = buildCompetitorQueries(companyName, categories, companyContext);

    let rawContext = companyContext;
    try {
        const { results } = await executeSearch(plannedQueries);
        if (results.length > 0) {
            rawContext +=
                "\n\nWeb search results (competitors / market):\n" +
                results
                    .slice(0, 12)
                    .map(
                        (r, i) => `${i + 1}. [${r.title}] ${r.content.slice(0, 200)}... (${r.url})`
                    )
                    .join("\n\n");
        }
    } catch (error) {
        console.warn("[marketing-pipeline] competitor web search failed:", error);
    }

    if (!rawContext.trim()) {
        rawContext = `Company: ${companyName}. Categories: ${categories.join(", ") || "Unknown"}. No search results.`;
    }

    const systemPrompt = `You are a competitive intelligence analyst. Given a company's description, categories, and web search results about competitors and the market, produce a structured CompetitorAnalysis.

CRITICAL: The company description tells you EXACTLY what industry and market this company operates in. Use it to identify the RIGHT competitors. Do NOT be confused by the company name — analyze competitors based on what the company DOES, not what its name sounds like. For example, a software company named "Launchstack" competes with other software companies, NOT with rocket companies.

Rules:
- Use ONLY information from the provided context and search results. Do not invent competitor names or quotes.
- Identify competitors in the SAME industry and market as described in the company context.
- If search results include irrelevant companies from a different industry, IGNORE them.
- If few or no relevant results: return empty or short placeholder arrays and "Not enough data" style strings where needed.
- competitors: array of { name, positioning (1 sentence), weaknesses (1-3 short items) } for up to 5 competitors.
- ourAdvantages: 2-5 short phrases where our company clearly wins (infer from context or leave minimal).
- marketGaps: 2-4 opportunities competitors miss.
- messagingAntiPatterns: 2-4 clichés or messages competitors use that we should avoid.

Return valid JSON matching the schema.`;

    const response = await invokeMarketingStructured(
        CompetitorAnalysisSchema,
        [new SystemMessage(systemPrompt), new HumanMessage(rawContext)],
        "competitor_analysis"
    );

    cache.set(buildCacheKey(companyName, categories), response);
    return response;
}
