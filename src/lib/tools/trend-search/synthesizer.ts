import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import type { RawSearchResult, SearchCategory, SearchResult } from "~/lib/tools/trend-search/types";

// ─── Output schema for LLM (validate SearchResult[]) ──────────────────────────

const SearchResultSchema = z.object({
    sourceUrl: z.string().describe("URL of the source (must be one of the provided raw result URLs)"),
    summary: z.string().describe("Short summary of the result"),
    description: z.string().describe("Longer description of relevance to the query and company"),
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
   - summary: a short summary (1-2 sentences).
   - description: a longer description of why this result is relevant to the query and company context.

You must only use sourceUrl values that appear in the raw results list. Do not add or invent URLs.`;

function buildHumanPrompt(
    rawResults: RawSearchResult[],
    query: string,
    companyContext: string,
    categories: SearchCategory[],
): string {
    const resultsBlock = rawResults
        .map(
            (r, i) =>
                `[${i + 1}] URL: ${r.url}\n    Title: ${r.title}\n    Content: ${r.content.slice(0, 500)}${r.content.length > 500 ? "..." : ""}\n    Score: ${r.score}`
        )
        .join("\n\n");

    const categoryBlock = categories.length > 0 ? `Categories of interest: ${categories.join(", ")}.` : "No category filter.";

    return `QUERY: ${query}

COMPANY CONTEXT: ${companyContext}

${categoryBlock}

RAW SEARCH RESULTS (use only these URLs as sourceUrl):
${resultsBlock}

Select up to 5 most relevant results, rank by relevance to company context, and provide sourceUrl (from the list above), summary, and description for each.`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Synthesizes raw search results into up to 5 SearchResults (summary + description).
 * If fewer than 5 raw results exist or LLM returns fewer, pads with placeholder entries.
 */
export async function synthesizeResults(
    rawResults: RawSearchResult[],
    query: string,
    companyContext: string,
    categories: SearchCategory[] = [],
): Promise<SearchResult[]> {
    const TARGET_COUNT = 5;

    if (rawResults.length === 0) {
        return Array.from({ length: TARGET_COUNT }, () => ({ ...PLACEHOLDER_RESULT }));
    }

    const chat = new ChatOpenAI({
        openAIApiKey: process.env.OPENAI_API_KEY,
        modelName: "gpt-5-nano-2025-08-07",
        temperature: 1,
    });

    const structuredModel = chat.withStructuredOutput(SynthesizerOutputSchema, {
        name: "synthesized_results",
    });

    const humanPrompt = buildHumanPrompt(rawResults, query, companyContext, categories);

    const response = await structuredModel.invoke([
        new SystemMessage(SYSTEM_PROMPT),
        new HumanMessage(humanPrompt),
    ]);

    const parsed = SynthesizerOutputSchema.safeParse(response);
    if (!parsed.success) {
        throw new Error(`Synthesizer output validation failed: ${parsed.error.message}`);
    }

    const synthesized = parsed.data.results as SearchResult[];
    const padded: SearchResult[] = [...synthesized];

    while (padded.length < TARGET_COUNT) {
        padded.push({ ...PLACEHOLDER_RESULT });
    }

    return padded.slice(0, TARGET_COUNT);
}
