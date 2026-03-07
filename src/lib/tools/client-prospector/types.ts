import { z } from "zod";

// ─── Location ────────────────────────────────────────────────────────────────

export const LatLngSchema = z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
});
export type LatLng = z.infer<typeof LatLngSchema>;

export const SearchLocationSchema = z.union([
    LatLngSchema,
    z.string().min(1).max(500), // city/region name to geocode
]);
export type SearchLocation = z.infer<typeof SearchLocationSchema>;

// ─── Input ───────────────────────────────────────────────────────────────────

export const DEFAULT_SEARCH_RADIUS = 5000; // 5km
export const MAX_SEARCH_RADIUS = 50000; // 50km

export const ProspectorInputSchema = z.object({
    query: z.string().min(1).max(1000),
    companyContext: z.string().min(1).max(2000),
    location: SearchLocationSchema,
    radius: z.number().int().min(100).max(50000).optional(),
    categories: z.array(z.string()).optional(), // Foursquare category IDs or names
    excludeChains: z.boolean().optional(), // exclude chain businesses (default: true)
});
export type ProspectorInput = z.infer<typeof ProspectorInputSchema>;

export const FoursquareCategoryIdSchema = z
    .string()
    .regex(/^[0-9a-fA-F]+$/, "Expected a valid Foursquare category ID");

// ─── Query Planner ───────────────────────────────────────────────────────────

export interface PlannedSearch {
    searchQuery: string; // query string for Foursquare
    categoryIds: string[]; // Foursquare category IDs
    rationale: string; // why this search is useful
}

// ─── Raw Place Result (from Foursquare) ──────────────────────────────────────

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

// ─── Scored Result ───────────────────────────────────────────────────────────

export interface ProspectResult {
    fsqId: string;
    name: string;
    address: string;
    location: LatLng;
    categories: string[]; // category names
    phone?: string;
    website?: string;
    rating?: number;
    relevanceScore: number; // 0-100, LLM-assigned
    rationale: string; // why this is a good prospect
}

// ─── Output ──────────────────────────────────────────────────────────────────

export interface ProspectorOutput {
    results: ProspectResult[];
    metadata: {
        query: string;
        companyContext: string;
        location: LatLng; // resolved lat/lng
        radius: number;
        categories: string[];
        createdAt: string;
    };
}

// ─── Job ─────────────────────────────────────────────────────────────────────

export type ProspectorJobStatus =
    | "queued"
    | "planning"
    | "searching"
    | "scoring"
    | "completed"
    | "failed";

export interface ProspectorJobRecord {
    id: string;
    companyId: bigint;
    userId: string;
    status: ProspectorJobStatus;
    input: ProspectorInput;
    output: ProspectorOutput | null;
    errorMessage: string | null;
    createdAt: Date;
    completedAt: Date | null;
}

// ─── Inngest event payload ───────────────────────────────────────────────────

export const ProspectorEventDataSchema = z.object({
    jobId: z.string(),
    companyId: z.string(), // serialized as string for Inngest
    userId: z.string(),
    query: z.string(),
    companyContext: z.string(),
    location: SearchLocationSchema,
    radius: z.number().int(),
    categories: z.array(z.string()).optional(),
    excludeChains: z.boolean().optional(),
});
export type ProspectorEventData = z.infer<typeof ProspectorEventDataSchema>;
