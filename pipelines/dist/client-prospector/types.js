import { z } from "zod";
// ─── Location ────────────────────────────────────────────────────────────────
export const LatLngSchema = z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
});
export const SearchLocationSchema = z.union([
    LatLngSchema,
    z.string().min(1).max(500), // city/region name to geocode
]);
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
export const FoursquareCategoryIdSchema = z
    .string()
    .regex(/^[0-9a-fA-F]+$/, "Expected a valid Foursquare category ID");
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
//# sourceMappingURL=types.js.map
