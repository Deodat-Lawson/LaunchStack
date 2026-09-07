import { z } from "zod";

// ─── Location, planned search, raw result ────────────────────────────────────
// Canonical shapes live in @launchstack/tools/place-search (distribution
// design P0). Re-exported under the prospector's historical names so callers
// keep their import paths.

export {
    LatLngSchema,
    SearchLocationSchema,
    DEFAULT_SEARCH_RADIUS,
    MAX_SEARCH_RADIUS,
    FoursquareCategoryIdSchema,
} from "@launchstack/tools/place-search";
export type { LatLng, SearchLocation, RawPlaceResult } from "@launchstack/tools/place-search";
export type { PlannedPlaceSearch as PlannedSearch } from "@launchstack/tools/place-search";

import { SearchLocationSchema } from "@launchstack/tools/place-search";
import type { LatLng } from "@launchstack/tools/place-search";

// ─── Input ───────────────────────────────────────────────────────────────────

export const ProspectorInputSchema = z.object({
    query: z.string().min(1).max(1000),
    companyContext: z.string().min(1).max(2000),
    location: SearchLocationSchema,
    radius: z.number().int().min(100).max(50000).optional(),
    categories: z.array(z.string()).optional(), // Foursquare category IDs or names
    excludeChains: z.boolean().optional(), // exclude chain businesses (default: true)
});
export type ProspectorInput = z.infer<typeof ProspectorInputSchema>;

// ─── Scored Result ───────────────────────────────────────────────────────────
// Canonical shape lives in @launchstack/core/db/schema (source of truth for
// the JSONB column). Re-exported here so feature code can keep its existing
// import path.

import type { ProspectResult } from "../schema";
export type { ProspectResult };

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
