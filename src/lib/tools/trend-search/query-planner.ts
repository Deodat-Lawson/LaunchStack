import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import type { PlannedQuery, SearchCategory } from "~/lib/tools/trend-search/types";
import { SearchCategoryEnum } from "~/lib/tools/trend-search/types";

// ─── Structured output schema for LLM ───────────────────────────────────────

const PlannedQuerySchema = z.object({
    searchQuery: z.string().describe("The search query string to send to the search engine"),
    category: SearchCategoryEnum.describe("One of: fashion, finance, business, tech"),
    rationale: z.string().describe("Brief reason why this query is useful for finding relevant news"),
});

// Output schema for the query planner (3-5 sub-queries)
const QueryPlannerOutputSchema = z.object({
    plannedQueries: z
        .array(PlannedQuerySchema)
        .min(3)
        .max(5)
        .describe("Between 3 and 5 search sub-queries focused on recent news and events"),
});

// ─── Prompts ─────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a search query planner for a trend and news search engine.

Your task is to generate 3-5 search sub-queries that will be sent to a web search API (configured for recent news and events). Each sub-query should be optimized to find relevant, recent news and trends.

RULES:
1. Generate between 3 and 5 sub-queries. Each sub-query will be executed separately.
2. Focus on recent news, events, and trends. Use terms that favor timely, news-style results.
3. CATEGORIES:
   - If the user does NOT provide a list of categories: infer relevant categories from the query and company context. Use only these four categories: fashion, finance, business, tech. Assign each sub-query to one of them.
   - If the user DOES provide categories: use ONLY those categories. Every sub-query's category must be one of the user-specified categories.
4. For each sub-query, include:
   - Category-relevant terms (industry, product, or trend terms for that category).
   - Company-relevant terms drawn from the company context so results are relevant to the company.
5. Output exactly: searchQuery (string), category (one of fashion, finance, business, tech), rationale (short explanation).`;

function buildHumanPrompt(
    query: string,
    companyContext: string,
    categories?: SearchCategory[],
): string {
    const categoryBlock =
        categories && categories.length > 0
            ? `Restrict to these categories only: ${categories.join(", ")}. Every planned query must use one of these categories.`
            : "Infer appropriate categories from the query and company context. Use only: fashion, finance, business, tech.";

    return `QUERY:
${query}

COMPANY CONTEXT:
${companyContext}

CATEGORIES: ${categoryBlock}

Generate 3-5 search sub-queries for recent news/events that are relevant to the query and company.`;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Plans 3-5 search sub-queries from a user prompt and company context.
 * When categories are omitted, the LLM infers them; when provided, only those categories are used.
 */
export async function planQueries(
    query: string,
    companyContext: string,
    categories?: SearchCategory[],
): Promise<PlannedQuery[]> {

    // Initialize the OpenAI chat model
    const chat = new ChatOpenAI({
        openAIApiKey: process.env.OPENAI_API_KEY,
        modelName: "gpt-4o-mini",
        temperature: 0.2,
    });

    const structuredModel = chat.withStructuredOutput(QueryPlannerOutputSchema, {
        name: "query_plan",
    });

    // Build the human prompt
    const humanPrompt = buildHumanPrompt(query, companyContext, categories);

    // Invoke the structured model
    const response = await structuredModel.invoke([
        new SystemMessage(SYSTEM_PROMPT),
        new HumanMessage(humanPrompt),
    ]);

    return response.plannedQueries as PlannedQuery[];
}
