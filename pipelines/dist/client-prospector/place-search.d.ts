import type { LatLng, PlannedSearch, RawPlaceResult } from "./types.js";
/**
 * Executes planned searches against the Foursquare Places API.
 *
 * - Runs each PlannedSearch as a separate API call
 * - Retries failed calls up to 2 times
 * - Deduplicates results by fsqId across all searches
 * - Logs and continues on zero results or failed searches
 */
export declare function executePlaceSearch(searches: PlannedSearch[], location: LatLng, radius: number, options?: {
    excludeChains?: boolean;
}): Promise<RawPlaceResult[]>;
//# sourceMappingURL=place-search.d.ts.map