/**
 * Foursquare Places provider (places-api.foursquare.com, 2025-06-17 API).
 *
 * Each planned search is one API call; failures retry twice; results are
 * deduplicated by fsq_place_id. The `fields` parameter is deliberately never
 * sent — requesting specific fields triggers Premium pricing and 429s on
 * free-tier accounts; the default Pro response already carries what we need.
 */
import { ToolError } from "../contract";
import { getFoursquareServiceKey } from "./config";
import type { LatLng, PlannedPlaceSearch, RawPlaceResult } from "./types";

const FOURSQUARE_SEARCH_URL = "https://places-api.foursquare.com/places/search";
const FOURSQUARE_API_VERSION = "2025-06-17";
const MAX_RESULTS_PER_SEARCH = 50;
const MAX_RETRIES = 2;

interface FoursquareCategory {
    fsq_category_id: string;
    name: string;
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
    closed_bucket?: string;
    date_closed?: string;
}

interface FoursquareSearchResponse {
    results?: FoursquarePlace[];
}

const CLOSED_BUCKETS = new Set(["VeryLikelyClosed", "LikelyClosed"]);

function requireApiKey(): string {
    const key = getFoursquareServiceKey();
    if (!key) {
        throw new ToolError({
            code: "place_search_not_configured",
            status: 503,
            message: "FOURSQUARE_SERVICE_KEY environment variable is not set.",
        });
    }
    return key;
}

/** True when the provider can be called at all (the key is present). */
export function isPlaceSearchConfigured(): boolean {
    return Boolean(getFoursquareServiceKey());
}

function mapFoursquarePlace(place: FoursquarePlace): RawPlaceResult | null {
    if (!place.fsq_place_id || !place.name) return null;
    if (place.date_closed) return null;
    if (place.closed_bucket && CLOSED_BUCKETS.has(place.closed_bucket)) return null;

    const lat = place.latitude;
    const lng = place.longitude;
    if (lat == null || lng == null) return null;

    return {
        fsqId: place.fsq_place_id,
        name: place.name,
        address: place.location?.address ?? "",
        formattedAddress: place.location?.formatted_address ?? "",
        location: { lat, lng },
        categories: (place.categories ?? []).map(c => ({ id: c.fsq_category_id, name: c.name })),
        phone: place.tel,
        website: place.website,
        description: place.description,
        distance: place.distance,
    };
}

async function callFoursquare(
    search: PlannedPlaceSearch,
    location: LatLng,
    radius: number,
    apiKey: string,
    options: { excludeChains: boolean; signal?: AbortSignal }
): Promise<RawPlaceResult[]> {
    const params = new URLSearchParams({
        query: search.searchQuery,
        ll: `${location.lat},${location.lng}`,
        radius: String(radius),
        limit: String(MAX_RESULTS_PER_SEARCH),
        sort: "RELEVANCE",
    });
    if (search.categoryIds.length > 0) params.set("categories", search.categoryIds.join(","));
    if (options.excludeChains) params.set("exclude_all_chains", "true");

    const response = await fetch(`${FOURSQUARE_SEARCH_URL}?${params.toString()}`, {
        method: "GET",
        headers: {
            Authorization: `Bearer ${apiKey}`,
            Accept: "application/json",
            "X-Places-Api-Version": FOURSQUARE_API_VERSION,
        },
        signal: options.signal,
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(
            `Foursquare API error: ${response.status} ${response.statusText} - ${text}`
        );
    }

    const data = (await response.json()) as FoursquareSearchResponse;
    if (!Array.isArray(data.results)) return [];
    return data.results.map(mapFoursquarePlace).filter((p): p is RawPlaceResult => p !== null);
}

async function searchWithRetries(
    search: PlannedPlaceSearch,
    location: LatLng,
    radius: number,
    apiKey: string,
    options: { excludeChains: boolean; signal?: AbortSignal }
): Promise<RawPlaceResult[]> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        if (options.signal?.aborted) throw lastError ?? new Error("aborted");
        try {
            return await callFoursquare(search, location, radius, apiKey, options);
        } catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err));
            if (attempt < MAX_RETRIES) {
                console.warn(
                    `[place-search] Search failed (attempt ${attempt + 1}/${MAX_RETRIES + 1}): "${search.searchQuery.slice(0, 50)}..."`,
                    lastError.message
                );
            }
        }
    }
    console.error(
        `[place-search] Search failed after ${MAX_RETRIES + 1} attempts: "${search.searchQuery.slice(0, 50)}..."`,
        lastError
    );
    return [];
}

export interface SearchPlacesOptions {
    /** Drop chain businesses (default true). */
    excludeChains?: boolean;
    signal?: AbortSignal;
}

/**
 * Executes planned searches against the Foursquare Places API: one call per
 * search, two retries each, results deduplicated by fsqId. A search that
 * fails after retries contributes nothing rather than failing the batch.
 */
export async function searchPlaces(
    searches: PlannedPlaceSearch[],
    location: LatLng,
    radius: number,
    options: SearchPlacesOptions = {}
): Promise<RawPlaceResult[]> {
    const apiKey = requireApiKey();
    const excludeChains = options.excludeChains ?? true;
    const seen = new Set<string>();
    const combined: RawPlaceResult[] = [];

    const settled = await Promise.allSettled(
        searches.map(search =>
            searchWithRetries(search, location, radius, apiKey, {
                excludeChains,
                signal: options.signal,
            })
        )
    );

    for (const [index, outcome] of settled.entries()) {
        const search = searches[index];
        if (!search) continue;
        if (outcome.status === "rejected") {
            console.error(
                `[place-search] Search promise rejected unexpectedly: "${search.searchQuery.slice(0, 50)}..."`,
                outcome.reason
            );
            continue;
        }
        if (outcome.value.length === 0) {
            console.warn(
                `[place-search] Zero results for search: "${search.searchQuery.slice(0, 80)}..."`
            );
            continue;
        }
        for (const place of outcome.value) {
            if (!seen.has(place.fsqId)) {
                seen.add(place.fsqId);
                combined.push(place);
            }
        }
    }
    return combined;
}
