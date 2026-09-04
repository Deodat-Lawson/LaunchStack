/**
 * Place-search planner — turns a natural-language ask into 2–4 provider
 * search parameter sets. The *perspective* (who the caller is looking for
 * and why) is caller data, not baked into the prompt: client-prospector
 * passes its "find potential clients" framing, the distribution pipeline
 * passes "find retail and wholesale accounts".
 */
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { invokeStructured, resolveChatModel } from "@launchstack/llm";
import { z } from "zod";

import { FoursquareCategoryIdSchema } from "./types";
import type { PlannedPlaceSearch } from "./types";

export const PLACE_PLANNER_PROMPT_VERSION = "place-search-planner/2026-09-03.1";

const PlannedSearchSchema = z.object({
    searchQuery: z
        .string()
        .min(1)
        .describe("The search query string to send to the places provider"),
    categoryIds: z.array(z.string()).describe("Foursquare category IDs to filter results"),
    rationale: z.string().describe("Brief reason why this search is useful"),
});

const PlannerOutputSchema = z.object({
    plannedSearches: z
        .array(PlannedSearchSchema)
        .min(2)
        .max(4)
        .describe("Between 2 and 4 search parameter sets"),
});

const COMMON_CATEGORIES = `Common Foursquare category IDs:
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
- 12009: Bookstore
- 17114: Wholesaler / Distributor
- 17000: Business and Professional Services
- 11041: Convenience Store
- 17043: Grocery Store / Specialty Food`;

function systemPrompt(perspective: string): string {
    return `You are a search query planner for a tool that uses the Foursquare Places API.

${perspective}

Your task is to generate 2-4 Foursquare search parameter sets. Each will be executed as a separate Foursquare Places API call.

RULES:
1. Generate between 2 and 4 search parameter sets.
2. Each set must include:
   - searchQuery: a concise query string optimized for Foursquare's place search. It must describe the TYPE OF PLACE being looked for. Foursquare matches this against business names, categories, and descriptions.
   - categoryIds: an array of Foursquare category IDs (numeric strings like "13065" for restaurants). Use real Foursquare category IDs.
   - rationale: a short explanation of why this search helps.
3. The searchQuery must ONLY contain terms describing the type of place being searched for. NEVER include the caller's own service or product keywords — those return the caller's competitors, not the targets.
4. Diversify searches to cover different sub-types of the target places.
5. Use category IDs to narrow results to the right business types. The searchQuery and categoryIds should be complementary.

CATEGORY HANDLING:
- If the caller does NOT provide categories: infer appropriate Foursquare category IDs from the query and context.
- If the caller DOES provide categories: use ONLY those category IDs. Every search must reference only IDs from the provided list.

${COMMON_CATEGORIES}`;
}

function humanPrompt(query: string, context: string, categories?: string[]): string {
    const validIds = (categories ?? []).filter(
        c => FoursquareCategoryIdSchema.safeParse(c).success
    );
    const labels = (categories ?? []).filter(c => !FoursquareCategoryIdSchema.safeParse(c).success);
    const categoryBlock =
        categories && categories.length > 0
            ? [
                  validIds.length > 0
                      ? `If helpful, constrain searches to these already-known Foursquare category IDs: ${validIds.join(", ")}.`
                      : null,
                  labels.length > 0
                      ? `Translate these user-provided category labels into the correct Foursquare category IDs before planning searches: ${labels.join(", ")}.`
                      : null,
                  "Every planned search must return only real Foursquare category IDs in categoryIds.",
              ]
                  .filter(Boolean)
                  .join(" ")
            : "Infer appropriate Foursquare category IDs from the query and context.";

    return `QUERY:
${query}

CONTEXT:
${context}

CATEGORIES: ${categoryBlock}

Generate 2-4 Foursquare search parameter sets.`;
}

export interface PlanPlaceSearchesInput {
    /** What the caller is looking for, in their words. */
    query: string;
    /** Background the planner should respect (the caller's company, the program). */
    context: string;
    /**
     * Who the targets are and who the caller is — the framing that decides
     * what counts as a competitor versus a target.
     */
    perspective: string;
    /** Provider category ids or human labels to constrain to. */
    categories?: string[];
}

export async function planPlaceSearches(
    input: PlanPlaceSearchesInput
): Promise<PlannedPlaceSearch[]> {
    const resolved = resolveChatModel({ route: "fast", temperature: 0.2 });
    const response = await invokeStructured(
        resolved,
        PlannerOutputSchema,
        [
            new SystemMessage(systemPrompt(input.perspective)),
            new HumanMessage(humanPrompt(input.query, input.context, input.categories)),
        ],
        { name: "search_plan" }
    );
    return response.plannedSearches as PlannedPlaceSearch[];
}
