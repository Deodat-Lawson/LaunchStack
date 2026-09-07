/**
 * place-search — plan, geocode, and execute searches for physical places
 * (retail accounts, wholesalers, prospects) through a places provider.
 *
 * Extracted from pipelines/src/client-prospector (business-associates design,
 * decision-log #6; distribution design P0). The prospector keeps its public
 * API by re-exporting from here; the distribution pipeline is the second
 * consumer. The targeting *perspective* is caller data (see planner.ts).
 */
export * from "./types";
export { geocodeLocation } from "./geocode";
export { isPlaceSearchConfigured, searchPlaces, type SearchPlacesOptions } from "./foursquare";
export {
    PLACE_PLANNER_PROMPT_VERSION,
    planPlaceSearches,
    type PlanPlaceSearchesInput,
} from "./planner";
