import { invokeStructured, resolveChatModel } from "@launchstack/llm";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import type { RawSearchResult, SearchCategory, SearchResult } from "./types";
import { ResultSubjectEnum } from "./types";

// ─── Output schema for LLM (validate SearchResult[]) ──────────────────────────

const SearchResultSchema = z.object({
    sourceUrl: z
        .string()
        .describe("URL of the source (must be one of the provided raw result URLs)"),
    summary: z.string().describe("Short summary of the result"),
    description: z.string().describe("Longer description of relevance to the query and company"),
    subject: ResultSubjectEnum.describe(
        'Who the result is about. "market": the wider market, a trend, a platform, or other companies. "company": the company in COMPANY CONTEXT itself (the same business, not just the same name). "namesake": a different company or product that only shares a name with the company or one of its products.'
    ),
});

const SynthesizerOutputSchema = z.object({
    results: z
        .array(SearchResultSchema)
        .max(5)
        .describe("Up to 5 selected and ranked results with summary and description"),
});

const PLACEHOLDER_RESULT: SearchResult = {
    sourceUrl: "",
    summary: "Insufficient results",
    description: "Not enough search results were found for this query.",
};

// ─── Prompts ─────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a trend search synthesizer. Your task is to select the most relevant web search results and present them for a user.

Given a list of raw search results (URL, title, content, score), the user's query, and company context:

1. Select up to 5 most relevant results. If fewer than 5 are provided, select all that are useful.
2. Rank them by relevance to the company context and the user's query.
3. For each selected result, output:
   - sourceUrl: exactly one of the URLs from the input raw results (do not invent URLs).
   - summary: a short summary (1-2 sentences) of what the result itself says.
   - description: a longer description of why this result is relevant to the query and company context.
   - subject: who the result is about. "market" for the wider market, a trend, a platform, or other companies (most results). "company" for the company in COMPANY CONTEXT itself. "namesake" for a different company or product that only shares a name with the company or one of its products.

WHO A RESULT IS ABOUT
COMPANY CONTEXT describes one specific company. The web is full of unrelated companies and products with the same name. A matching name is not enough: a result is about this company only when the business it describes is the one in COMPANY CONTEXT. If the names match and the business differs, or you cannot tell, it is a namesake.
- Do not select a namesake when another result will do. If you do select one, mark it "namesake".
- Never write, in summary or description, that something a result describes belongs to the company (a product, feature, technology, customer, funding or result) unless COMPANY CONTEXT says so. The description explains why a result matters to the company's market; it does not add facts about the company.

You must only use sourceUrl values that appear in the raw results list. Do not add or invent URLs.`;

function buildHumanPrompt(
    rawResults: RawSearchResult[],
    query: string,
    companyContext: string,
    categories: SearchCategory[]
): string {
    const resultsBlock = rawResults
        .map(
            (r, i) =>
                `[${i + 1}] URL: ${r.url}\n    Title: ${r.title}\n    Content: ${r.content.slice(0, 500)}${r.content.length > 500 ? "..." : ""}\n    Score: ${r.score}`
        )
        .join("\n\n");

    const categoryBlock =
        categories.length > 0
            ? `Categories of interest: ${categories.join(", ")}.`
            : "No category filter.";

    return `QUERY: ${query}

COMPANY CONTEXT: ${companyContext}

${categoryBlock}

RAW SEARCH RESULTS (use only these URLs as sourceUrl):
${resultsBlock}

Select up to 5 most relevant results, rank by relevance to company context, and provide sourceUrl (from the list above), summary, description, and subject for each.`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Synthesizes raw search results into up to 5 SearchResults (summary + description).
 * If fewer than 5 raw results exist or LLM returns fewer, pads with placeholder entries.
 *
 * A result the model judges to be about a namesake (a different company or
 * product that only shares the company's name) is dropped here, for every
 * caller: nothing in it is true of the company the search was run for. The
 * rest carry `subject`, so a caller that wants only the outside world (the
 * campaign generator) can leave out results about the company too.
 */
export async function synthesizeResults(
    rawResults: RawSearchResult[],
    query: string,
    companyContext: string,
    categories: SearchCategory[] = []
): Promise<SearchResult[]> {
    const TARGET_COUNT = 5;

    if (rawResults.length === 0) {
        return Array.from({ length: TARGET_COUNT }, () => ({ ...PLACEHOLDER_RESULT }));
    }

    const resolved = resolveChatModel({ route: "fast" });

    const humanPrompt = buildHumanPrompt(rawResults, query, companyContext, categories);

    const response = await invokeStructured(
        resolved,
        SynthesizerOutputSchema,
        [new SystemMessage(SYSTEM_PROMPT), new HumanMessage(humanPrompt)],
        { name: "synthesized_results" }
    );

    const parsed = SynthesizerOutputSchema.safeParse(response);
    if (!parsed.success) {
        throw new Error(`Synthesizer output validation failed: ${parsed.error.message}`);
    }

    const padded: SearchResult[] = [];
    let namesakes = 0;
    for (const result of parsed.data.results) {
        if (result.subject === "namesake") {
            namesakes += 1;
            continue;
        }
        padded.push({ ...result, subject: result.subject });
    }
    if (namesakes > 0) {
        console.log(
            `[trend-search] dropped ${namesakes} result${namesakes !== 1 ? "s" : ""} about a same-name company or product`
        );
    }

    while (padded.length < TARGET_COUNT) {
        padded.push({ ...PLACEHOLDER_RESULT });
    }

    return padded.slice(0, TARGET_COUNT);
}
