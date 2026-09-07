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
const STAGE_LABELS = {
    planning: "Planning searches",
    searching: "Searching places",
    scoring: "Scoring leads",
};
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
    const providedCategoryIds = (input.categories ?? []).filter(category => FoursquareCategoryIdSchema.safeParse(category).success);
    // Step 1: Resolve location
    const resolvedLocation = await resolveLocation(input.location);
    // Step 2: Plan searches — LLM decides what Foursquare queries to run
    await options.onStageChange?.("planning");
    options.onProgress?.({ type: "step_start", step: "planning", label: STAGE_LABELS.planning });
    const planStart = Date.now();
    const plannedSearches = await planSearches(input.query, input.companyContext, input.categories);
    options.onProgress?.({
        type: "step_complete",
        step: "planning",
        durationMs: Date.now() - planStart,
        detail: `${plannedSearches.length} search${plannedSearches.length !== 1 ? "es" : ""} planned`,
        status: "completed",
    });
    console.log(`[prospector] Planned ${plannedSearches.length} searches:`, plannedSearches.map(s => ({ query: s.searchQuery, categories: s.categoryIds })));
    // Step 3: Search — call Foursquare Places API for each planned search
    await options.onStageChange?.("searching");
    options.onProgress?.({ type: "step_start", step: "searching", label: STAGE_LABELS.searching });
    const searchStart = Date.now();
    const rawPlaces = await executePlaceSearch(plannedSearches, resolvedLocation, radius, {
        excludeChains: input.excludeChains ?? true,
    });
    options.onProgress?.({
        type: "step_complete",
        step: "searching",
        durationMs: Date.now() - searchStart,
        detail: `${rawPlaces.length} place${rawPlaces.length !== 1 ? "s" : ""} found`,
        status: "completed",
    });
    // Step 4: Score — LLM ranks and scores the results by relevance
    await options.onStageChange?.("scoring");
    options.onProgress?.({ type: "step_start", step: "scoring", label: STAGE_LABELS.scoring });
    const scoreStart = Date.now();
    const resolvedCategories = providedCategoryIds.length > 0
        ? providedCategoryIds
        : [...new Set(plannedSearches.flatMap(s => s.categoryIds))];
    const results = await scoreLeads(rawPlaces, input.query, input.companyContext, resolvedCategories);
    options.onProgress?.({
        type: "step_complete",
        step: "scoring",
        durationMs: Date.now() - scoreStart,
        detail: `${results.length} lead${results.length !== 1 ? "s" : ""} scored`,
        status: "completed",
    });
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