import type { LatLng, SearchLocation } from "./types.js";
/**
 * Resolves a SearchLocation to concrete LatLng coordinates.
 *
 * - If the input is already a LatLng object, returns it unchanged.
 * - If the input is a string, geocodes it via an LLM call.
 * - Throws a descriptive error if geocoding fails.
 */
export declare function resolveLocation(location: SearchLocation): Promise<LatLng>;
//# sourceMappingURL=location-resolver.d.ts.map