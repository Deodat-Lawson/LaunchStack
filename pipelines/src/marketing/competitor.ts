import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import {
    configuredWebSearchProvider,
    createTtlCache,
    searchWeb,
} from "@launchstack/tools/web-research";
import type { WebSearchHit } from "@launchstack/tools/web-research";
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
): string[] {
    const categoryStr = categories.length > 0 ? categories.join(" ") : "industry";
    const currentYear = new Date().getFullYear();

    const descHint = companyDescription
        ? ` ${companyDescription.split(/\s+/).slice(0, 12).join(" ")}`
        : "";

    return [
        // Direct competitors, the company description disambiguating the name
        `"${companyName}"${descHint} competitors ${categoryStr} ${currentYear}`,
        // Alternatives and market leaders in the same category
        `${categoryStr} market leaders alternative solutions ${currentYear}`,
    ];
}

/* ──────────────────────────────────────────────────────────────
 * Web search
 * ────────────────────────────────────────────────────────────── */

/** Results per query; two queries fill the 12 hits the prompt shows. */
const RESULTS_PER_QUERY = 6;

/**
 * General web search, not news: competitors are found on their own sites and
 * on comparison pages. One query failing keeps the other's hits; no search
 * key means no hits, and the analysis runs on the company context alone.
 */
async function searchCompetitorWeb(queries: string[]): Promise<WebSearchHit[]> {
    if (configuredWebSearchProvider() === null) return [];
    const settled = await Promise.allSettled(
        queries.map(query => searchWeb(query, { maxResults: RESULTS_PER_QUERY, snippetChars: 200 }))
    );
    const seen = new Set<string>();
    const hits: WebSearchHit[] = [];
    for (const outcome of settled) {
        if (outcome.status === "rejected") {
            console.warn("[marketing-pipeline] competitor web search failed:", outcome.reason);
            continue;
        }
        for (const hit of outcome.value.results) {
            if (seen.has(hit.url)) continue;
            seen.add(hit.url);
            hits.push(hit);
        }
    }
    return hits;
}

/* ──────────────────────────────────────────────────────────────
 * What the analyst is shown
 * ────────────────────────────────────────────────────────────── */

const OUR_COMPANY_HEADING = "## Our company (the only source of facts about us)";
const WEB_RESULTS_HEADING =
    "## Web search results (other companies and the market; never facts about us)";

/**
 * Two labelled blocks, ours first. The search is run on the company's name,
 * so its hits routinely include an unrelated company or product called the
 * same thing; unlabelled, the analyst read those as us and wrote their
 * features into `ourAdvantages`. The heading and the note under it say whose
 * pages these are before the first hit is read.
 */
function buildAnalystInput(args: {
    companyName: string;
    categories: string[];
    companyContext: string;
    results: WebSearchHit[];
}): string {
    const { companyName, categories, results } = args;
    const ours =
        args.companyContext.trim() ||
        `Company: ${companyName}. Categories: ${categories.join(", ") || "Unknown"}.`;
    const parts = [OUR_COMPANY_HEADING, ours];
    if (results.length > 0) {
        parts.push(
            "",
            WEB_RESULTS_HEADING,
            `A result that mentions "${companyName}", a close variant of that name, or one of our products is about a different company unless it describes the same business as the block above.`,
            "",
            results
                .slice(0, 12)
                .map((r, i) => `${i + 1}. [${r.title}] ${r.snippet} (${r.url})`)
                .join("\n\n")
        );
    } else {
        parts.push("", "No web search results.");
    }
    return parts.join("\n");
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

    const queries = buildCompetitorQueries(companyName, categories, companyContext);
    const results = await searchCompetitorWeb(queries);
    const rawContext = buildAnalystInput({ companyName, categories, companyContext, results });

    const systemPrompt = `You are a competitive intelligence analyst. You are given two blocks: "Our company" (who we are) and, when a web search ran, "Web search results" (pages about other companies and the market). Produce a structured CompetitorAnalysis.

CRITICAL: who is who.
- "Our company" tells you EXACTLY what industry and market we operate in. Use it to identify the RIGHT competitors: analyze competitors based on what the company DOES, not what its name sounds like. For example, a software company named "Launchstack" competes with other software companies, NOT with rocket companies.
- A name is not an identity. Search results often include a different company or product that happens to share our company's name, or the name of one of our products. Unless a result plainly describes the same business as "Our company", it is someone else: do not use it to describe us, do not credit us with its features, technology, customers or results, and do not list it as a competitor.
- Nothing in the search results is a fact about us. Everything you say about us must be stated in "Our company".

Rules:
- Use ONLY information from the two blocks. Do not invent competitor names or quotes.
- Identify competitors in the SAME industry and market as described in "Our company".
- If search results include irrelevant companies from a different industry, IGNORE them.
- If few or no relevant results: return empty or short placeholder arrays and "Not enough data" style strings where needed.
- competitors: array of { name, positioning (1 sentence), weaknesses (1-3 short items) } for up to 5 competitors.
- ourAdvantages: 0-5 short phrases where our company wins. Each must restate something "Our company" says about us, set against what the results show about competitors. Never take one from a search result. If "Our company" does not support any, return an empty array.
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
