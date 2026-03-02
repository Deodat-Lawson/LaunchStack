// Place search executor for the Client Prospector pipeline.
//
// Executes planned search parameter sets against the Foursquare Places API
// (new endpoint: places-api.foursquare.com) and returns combined, deduplicated
// raw place results.
//
// Each PlannedSearch triggers one Foursquare API call. Failed calls are retried
// up to 2 times. Results are deduplicated by fsq_place_id across all searches.
//
// IMPORTANT: Do NOT pass the `fields` parameter — it triggers Premium pricing.
// The default Pro response includes all the fields we need.

import type { LatLng, PlannedSearch, RawPlaceResult } from "~/lib/tools/client-prospector/types";

// Foursquare new Places API endpoint (post June 17 2025 accounts)
const FOURSQUARE_SEARCH_URL = "https://places-api.foursquare.com/places/search";
const FOURSQUARE_API_VERSION = "2025-06-17";
const MAX_RESULTS_PER_SEARCH = 50;
const MAX_RETRIES = 2;

// ─── Foursquare response types (new API, default Pro fields) ─────────────────

interface FoursquareCategory {
    fsq_category_id: string;
    name: string;
    short_name?: string;
    plural_name?: string;
    icon?: { prefix: string; suffix: string };
}

interface FoursquarePlace {
    fsq_place_id?: string;
    name?: string;
    categories?: FoursquareCategory[];
    location?: {
        address?: string;
        formatted_address?: string;
        locality?: string;
        region?: string;
        postcode?: string;
        country?: string;
    };
    latitude?: number;
    longitude?: number;
    tel?: string;
    email?: string;
    website?: string;
    description?: string;
    distance?: number;
    social_media?: {
        facebook_id?: string;
        instagram?: string;
        twitter?: string;
    };
}

interface FoursquareSearchResponse {
    results?: FoursquarePlace[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getApiKey(): string {
    const key = process.env.FOURSQUARE_SERVICE_KEY;
    if (!key) {
        throw new Error("FOURSQUARE_SERVICE_KEY environment variable is not set.");
    }
    return key;
}

function mapFoursquarePlace(place: FoursquarePlace): RawPlaceResult | null {
    if (!place.fsq_place_id || !place.name) return null;

    const lat = place.latitude;
    const lng = place.longitude;
    if (lat == null || lng == null) return null;

    return {
        fsqId: place.fsq_place_id,
        name: place.name,
        address: place.location?.address ?? "",
        formattedAddress: place.location?.formatted_address ?? "",
        location: { lat, lng },
        categories: (place.categories ?? []).map((c) => ({
            id: c.fsq_category_id,
            name: c.name,
        })),
        phone: place.tel,
        website: place.website,
        description: place.description,
        distance: place.distance,
    };
}

/**
 * Calls the Foursquare Places API for a single search parameter set.
 *
 * NOTE: We intentionally omit the `fields` parameter. Requesting specific
 * fields (especially rating, stats, verified) triggers Premium pricing and
 * returns 429 on free-tier accounts. The default Pro response includes all
 * the fields we need: fsq_place_id, name, categories, location, lat/lng,
 * tel, website, distance, description, email, social_media.
 */
async function callFoursquare(
    search: PlannedSearch,
    location: LatLng,
    radius: number,
    apiKey: string,
): Promise<RawPlaceResult[]> {
    const params = new URLSearchParams({
        query: search.searchQuery,
        ll: `${location.lat},${location.lng}`,
        radius: String(radius),
        limit: String(MAX_RESULTS_PER_SEARCH),
    });

    if (search.categoryIds.length > 0) {
        params.set("categories", search.categoryIds.join(","));
    }

    const url = `${FOURSQUARE_SEARCH_URL}?${params.toString()}`;

    const response = await fetch(url, {
        method: "GET",
        headers: {
            Authorization: `Bearer ${apiKey}`,
            Accept: "application/json",
            "X-Places-Api-Version": FOURSQUARE_API_VERSION,
        },
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Foursquare API error: ${response.status} ${response.statusText} - ${text}`);
    }

    const data = (await response.json()) as FoursquareSearchResponse;
    if (!data.results || !Array.isArray(data.results)) {
        return [];
    }

    return data.results
        .map(mapFoursquarePlace)
        .filter((p): p is RawPlaceResult => p !== null);
}

// ─── Public API ──────────────────────────────────────────────────────────────

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
): Promise<RawPlaceResult[]> {
    const apiKey = getApiKey();
    const seenIds = new Set<string>();
    const combined: RawPlaceResult[] = [];

    for (const search of searches) {
        let lastError: Error | null = null;
        let results: RawPlaceResult[] = [];

        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            try {
                results = await callFoursquare(search, location, radius, apiKey);
                lastError = null;
                break;
            } catch (err) {
                lastError = err instanceof Error ? err : new Error(String(err));
                if (attempt < MAX_RETRIES) {
                    console.warn(
                        `[place-search] Search failed (attempt ${attempt + 1}/${MAX_RETRIES + 1}): "${search.searchQuery.slice(0, 50)}..."`,
                        lastError.message,
                    );
                } else {
                    console.error(
                        `[place-search] Search failed after ${MAX_RETRIES + 1} attempts: "${search.searchQuery.slice(0, 50)}..."`,
                        lastError,
                    );
                }
            }
        }

        if (results.length === 0 && lastError) {
            continue;
        }

        if (results.length === 0) {
            console.warn(`[place-search] Zero results for search: "${search.searchQuery.slice(0, 80)}..."`);
            continue;
        }

        for (const place of results) {
            if (!seenIds.has(place.fsqId)) {
                seenIds.add(place.fsqId);
                combined.push(place);
            }
        }
    }

    return combined;
}
