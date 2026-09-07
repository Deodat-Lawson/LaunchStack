// Location resolver for the Client Prospector pipeline.
//
// Extracted to @launchstack/tools/place-search (distribution design P0); the
// prospector keeps its function name.
import { geocodeLocation } from "@launchstack/tools/place-search";
/**
 * Resolves a SearchLocation to concrete LatLng coordinates.
 *
 * - If the input is already a LatLng object, returns it unchanged.
 * - If the input is a string, geocodes it via an LLM call.
 * - Throws a descriptive error if geocoding fails.
 */
export async function resolveLocation(location) {
    return geocodeLocation(location);
}
//# sourceMappingURL=location-resolver.js.map