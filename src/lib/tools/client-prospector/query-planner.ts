// Query planner for the Client Prospector pipeline.
//
// Takes the user's natural language prompt and company context, then uses
// an LLM to generate 2-4 optimized Foursquare search parameter sets.
// Each set contains a search query string and Foursquare category IDs.
//
// When categories are not provided, the LLM infers appropriate ones.
// When categories are provided, the LLM constrains searches to those only.

import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import type { PlannedSearch } from "~/lib/tools/client-prospector/types";

// ─── Structured output schema for LLM ───────────────────────────────────────

const PlannedSearchSchema = z.object({
    searchQuery: z.string().min(1).describe("The search query string to send to Foursquare Places API"),
    categoryIds: z.array(z.string()).describe("Foursquare category IDs to filter results"),
    rationale: z.string().describe("Brief reason why this search is useful for finding prospects"),
});

const QueryPlannerOutputSchema = z.object({
    plannedSearches: z
        .array(PlannedSearchSchema)
        .min(2)
        .max(4)
        .describe("Between 2 and 4 Foursquare search parameter sets"),
});

// ─── Prompts ─────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a search query planner for a client prospecting tool that uses the Foursquare Places API.

Your task is to generate 2-4 Foursquare search parameter sets that will find businesses matching the user's prospecting criteria. Each parameter set will be executed as a separate Foursquare Places API call.

RULES:
1. Generate between 2 and 4 search parameter sets.
2. Each set must include:
   - searchQuery: a concise query string optimized for Foursquare's place search (business names, types, or keywords).
   - categoryIds: an array of Foursquare category IDs (numeric strings like "13065" for restaurants). Use real Foursquare category IDs.
   - rationale: a short explanation of why this search helps find prospects.
3. Focus on business types that are plausible CLIENT prospects for the user's company based on the company context.
4. Include company-relevant keywords in search queries so results are relevant to the user's business.
5. Diversify searches to cover different angles of the prospecting query.

CATEGORY HANDLING:
- If the user does NOT provide categories: infer appropriate Foursquare category IDs from the query and company context.
- If the user DOES provide categories: use ONLY those category IDs. Every search must reference only IDs from the provided list.

Common Foursquare category IDs:
- 13065: Restaurant
- 13032: Café
- 11104: Clothing Store
- 17069: Marketing Agency
- 11045: Electronics Store
- 12057: Gym / Fitness Center
- 11058: Furniture Store
- 13003: Bar
- 17042: Law Office
- 17018: Accounting Office
- 15014: Hotel
- 12072: Supermarket
- 11063: Jewelry Store
- 17057: Real Estate Office
- 12009: Bookstore`;

function buildHumanPrompt(
    query: string,
    companyContext: string,
    categories?: string[],
): string {
    const categoryBlock =
        categories && categories.length > 0
            ? `Use ONLY these Foursquare category IDs: ${categories.join(", ")}. Every planned search must use only IDs from this list.`
            : "Infer appropriate Foursquare category IDs from the query and company context.";

    return `PROSPECTING QUERY:
${query}

COMPANY CONTEXT:
${companyContext}

CATEGORIES: ${categoryBlock}

Generate 2-4 Foursquare search parameter sets to find potential client businesses matching this query.`;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Plans 2-4 Foursquare search parameter sets from a user prompt and company context.
 * When categories are omitted, the LLM infers them; when provided, only those are used.
 */
export async function planSearches(
    query: string,
    companyContext: string,
    categories?: string[],
): Promise<PlannedSearch[]> {
    const chat = new ChatOpenAI({
        openAIApiKey: process.env.OPENAI_API_KEY,
        modelName: "gpt-4o-mini",
        temperature: 0.2,
    });

    const structuredModel = chat.withStructuredOutput(QueryPlannerOutputSchema, {
        name: "search_plan",
    });

    const humanPrompt = buildHumanPrompt(query, companyContext, categories);

    const response = await structuredModel.invoke([
        new SystemMessage(SYSTEM_PROMPT),
        new HumanMessage(humanPrompt),
    ]);

    return response.plannedSearches as PlannedSearch[];
}
