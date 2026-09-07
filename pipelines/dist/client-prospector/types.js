import { z } from "zod";
// ─── Location, planned search, raw result ────────────────────────────────────
// Canonical shapes live in @launchstack/tools/place-search (distribution
// design P0). Re-exported under the prospector's historical names so callers
// keep their import paths.
export { LatLngSchema, SearchLocationSchema, DEFAULT_SEARCH_RADIUS, MAX_SEARCH_RADIUS, FoursquareCategoryIdSchema, } from "@launchstack/tools/place-search";
import { SearchLocationSchema } from "@launchstack/tools/place-search";
// ─── Input ───────────────────────────────────────────────────────────────────
export const ProspectorInputSchema = z.object({
    query: z.string().min(1).max(1000),
    companyContext: z.string().min(1).max(2000),
    location: SearchLocationSchema,
    radius: z.number().int().min(100).max(50000).optional(),
    categories: z.array(z.string()).optional(), // Foursquare category IDs or names
    excludeChains: z.boolean().optional(), // exclude chain businesses (default: true)
});
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