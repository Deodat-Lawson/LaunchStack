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

import { FoursquareCategoryIdSchema } from "./types";
import type { PlannedSearch } from "./types";

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

CONTEXT: The user's company wants to find POTENTIAL CLIENTS — businesses they can sell their services to. Your job is to generate Foursquare search queries that find those TARGET businesses, NOT businesses similar to the user's own company.

Example: If the user is a "digital marketing agency looking for restaurant clients", you should search for RESTAURANTS, not marketing agencies. The restaurants are the prospects.

Your task is to generate 2-4 Foursquare search parameter sets. Each will be executed as a separate Foursquare Places API call.

RULES:
1. Generate between 2 and 4 search parameter sets.
2. Each set must include:
   - searchQuery: a concise query string optimized for Foursquare's place search. This should describe the TARGET business type (e.g. "restaurant", "café", "bakery"), NOT the user's services. Foursquare matches this against business names, categories, and descriptions.
   - categoryIds: an array of Foursquare category IDs (numeric strings like "13065" for restaurants). Use real Foursquare category IDs.
   - rationale: a short explanation of why this search helps find prospects.
3. The searchQuery must ONLY contain terms describing the type of business being searched for. NEVER include the user's service keywords (e.g. "marketing", "SEO", "consulting") in the searchQuery — those will return the user's competitors, not their prospects.
4. Diversify searches to cover different sub-types of the target businesses (e.g. for food & beverage: "restaurant", "café", "bakery", "bar").
5. Use category IDs to narrow results to the right business types. The searchQuery and categoryIds should be complementary.

CATEGORY HANDLING:
- If the user does NOT provide categories: infer appropriate Foursquare category IDs from the query and company context. Choose categories that represent the TARGET client businesses.
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
    const validCategoryIds = (categories ?? []).filter((category) =>
        FoursquareCategoryIdSchema.safeParse(category).success,
    );
    const categoryLabels = (categories ?? []).filter(
        (category) => !FoursquareCategoryIdSchema.safeParse(category).success,
    );
    const categoryBlock =
        categories && categories.length > 0
            ? [
                  validCategoryIds.length > 0
                      ? `If helpful, constrain searches to these already-known Foursquare category IDs: ${validCategoryIds.join(", ")}.`
                      : null,
                  categoryLabels.length > 0
                      ? `Translate these user-provided category labels into the correct Foursquare category IDs before planning searches: ${categoryLabels.join(", ")}.`
                      : null,
                  "Every planned search must return only real Foursquare category IDs in categoryIds.",
              ]
                  .filter(Boolean)
                  .join(" ")
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
        apiKey: process.env.OPENAI_API_KEY || process.env.AI_API_KEY,
        modelName: "gpt-4o-mini",
        temperature: 0.2,
        ...(process.env.AI_BASE_URL ? { configuration: { baseURL: process.env.AI_BASE_URL } } : {}),
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
