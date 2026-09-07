import { z } from "zod";

// ─── Location ────────────────────────────────────────────────────────────────

export const LatLngSchema = z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
});
export type LatLng = z.infer<typeof LatLngSchema>;

/** Either coordinates or a place name to geocode. */
export const SearchLocationSchema = z.union([LatLngSchema, z.string().min(1).max(500)]);
export type SearchLocation = z.infer<typeof SearchLocationSchema>;

export const DEFAULT_SEARCH_RADIUS = 5000; // 5km
export const MAX_SEARCH_RADIUS = 50000; // 50km

/** Foursquare category ids are hex strings (legacy numeric ids are hex too). */
export const FoursquareCategoryIdSchema = z
    .string()
    .regex(/^[0-9a-fA-F]+$/, "Expected a valid Foursquare category ID");

// ─── Planned search ──────────────────────────────────────────────────────────

export interface PlannedPlaceSearch {
    /** Query string for the places provider. */
    searchQuery: string;
    /** Provider category ids to filter by. */
    categoryIds: string[];
    /** Why this search is useful. */
    rationale: string;
}

// ─── Raw place result ────────────────────────────────────────────────────────

export interface RawPlaceResult {
    fsqId: string;
    name: string;
    address: string;
    formattedAddress: string;
    location: LatLng;
    categories: Array<{ id: string; name: string }>;
    phone?: string;
    website?: string;
    rating?: number;
    totalRatings?: number;
    description?: string;
    verified?: boolean;
    distance?: number;
}
