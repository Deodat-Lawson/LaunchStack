// Place search executor for the Client Prospector pipeline.
//
// Extracted to @launchstack/tools/place-search (distribution design P0). This
// module keeps the prospector's public function name and signature.

import { searchPlaces } from "@launchstack/tools/place-search";

import type { LatLng, PlannedSearch, RawPlaceResult } from "./types";

/**
 * Executes planned searches against the Foursquare Places API.
 *
 * - Runs each PlannedSearch as a separate API call
 * - Retries failed calls up to 2 times
 * - Deduplicates results by fsqId across all searches
 * - Logs and continues on zero results or failed searches
 */
export async function executePlaceSearch(
    searches: PlannedSearch[],
    location: LatLng,
    radius: number,
    options: { excludeChains?: boolean } = {}
): Promise<RawPlaceResult[]> {
    return searchPlaces(searches, location, radius, { excludeChains: options.excludeChains });
}
