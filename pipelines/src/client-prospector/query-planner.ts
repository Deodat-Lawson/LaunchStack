// Query planner for the Client Prospector pipeline.
//
// The planner itself lives in @launchstack/tools/place-search (distribution
// design P0). What stays here is the prospector's *perspective* — the framing
// that tells the planner the targets are potential clients, not peers.

import { planPlaceSearches } from "@launchstack/tools/place-search";

import type { PlannedSearch } from "./types";

export const PROSPECTOR_PERSPECTIVE = `CONTEXT: The user's company wants to find POTENTIAL CLIENTS — businesses they can sell their services to. Your job is to generate Foursquare search queries that find those TARGET businesses, NOT businesses similar to the user's own company.

Example: If the user is a "digital marketing agency looking for restaurant clients", you should search for RESTAURANTS, not marketing agencies. The restaurants are the prospects.`;

/**
 * Plans 2-4 Foursquare search parameter sets from a user prompt and company context.
 * When categories are omitted, the LLM infers them; when provided, only those are used.
 */
export async function planSearches(
    query: string,
    companyContext: string,
    categories?: string[]
): Promise<PlannedSearch[]> {
    return planPlaceSearches({
        query,
        context: companyContext,
        perspective: PROSPECTOR_PERSPECTIVE,
        categories,
    });
}
