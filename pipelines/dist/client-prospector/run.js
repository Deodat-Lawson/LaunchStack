// Client Prospector pipeline entry point.
//
// This is the core pipeline function that chains:
//   resolveLocation → planSearches → executePlaceSearch → scoreLeads
//
// It is a pure pipeline — no DB writes, no side effects.
// The Inngest function calls this and handles persistence separately.
// This can also be invoked directly by AI agents for synchronous use.
import { DEFAULT_SEARCH_RADIUS, FoursquareCategoryIdSchema } from "./types.js";
import { resolveLocation } from "./location-resolver.js";
import { planSearches } from "./query-planner.js";
import { executePlaceSearch } from "./place-search.js";
import { scoreLeads } from "./scorer.js";
/**
 * Runs the full Client Prospector pipeline:
 *   1. Resolve location to lat/lng (pass-through if already coordinates)
 *   2. Plan Foursquare searches via LLM
 *   3. Execute searches against Foursquare Places API
 *   4. Score and rank results via LLM
 *
 * Pure pipeline — no DB writes. Callers own persistence.
 */
export async function runClientProspector(input, options = {}) {
    const radius = input.radius ?? DEFAULT_SEARCH_RADIUS;
    const providedCategoryIds = (input.categories ?? []).filter(
        category => FoursquareCategoryIdSchema.safeParse(category).success
    );
    // Step 1: Resolve location
    const resolvedLocation = await resolveLocation(input.location);
    // Step 2: Plan searches — LLM decides what Foursquare queries to run
    await options.onStageChange?.("planning");
    const plannedSearches = await planSearches(input.query, input.companyContext, input.categories);
    console.log(
        `[prospector] Planned ${plannedSearches.length} searches:`,
        plannedSearches.map(s => ({ query: s.searchQuery, categories: s.categoryIds }))
    );
    // Step 3: Search — call Foursquare Places API for each planned search
    await options.onStageChange?.("searching");
    const rawPlaces = await executePlaceSearch(plannedSearches, resolvedLocation, radius, {
        excludeChains: input.excludeChains ?? true,
    });
    // Step 4: Score — LLM ranks and scores the results by relevance
    await options.onStageChange?.("scoring");
    const resolvedCategories =
        providedCategoryIds.length > 0
            ? providedCategoryIds
            : [...new Set(plannedSearches.flatMap(s => s.categoryIds))];
    const results = await scoreLeads(
        rawPlaces,
        input.query,
        input.companyContext,
        resolvedCategories
    );
    return {
        results,
        metadata: {
            query: input.query,
            companyContext: input.companyContext,
            location: resolvedLocation,
            radius,
            categories: resolvedCategories,
            createdAt: new Date().toISOString(),
        },
    };
}
//# sourceMappingURL=run.js.map
