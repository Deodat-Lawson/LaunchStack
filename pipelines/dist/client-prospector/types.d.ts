import { z } from "zod";
export { LatLngSchema, SearchLocationSchema, DEFAULT_SEARCH_RADIUS, MAX_SEARCH_RADIUS, FoursquareCategoryIdSchema, } from "@launchstack/tools/place-search";
export type { LatLng, SearchLocation, RawPlaceResult } from "@launchstack/tools/place-search";
export type { PlannedPlaceSearch as PlannedSearch } from "@launchstack/tools/place-search";
import type { LatLng } from "@launchstack/tools/place-search";
export declare const ProspectorInputSchema: z.ZodObject<{
    query: z.ZodString;
    companyContext: z.ZodString;
    location: z.ZodUnion<[z.ZodObject<{
        lat: z.ZodNumber;
        lng: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        lat: number;
        lng: number;
    }, {
        lat: number;
        lng: number;
    }>, z.ZodString]>;
    radius: z.ZodOptional<z.ZodNumber>;
    categories: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    excludeChains: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    query: string;
    companyContext: string;
    location: string | {
        lat: number;
        lng: number;
    };
    categories?: string[] | undefined;
    radius?: number | undefined;
    excludeChains?: boolean | undefined;
}, {
    query: string;
    companyContext: string;
    location: string | {
        lat: number;
        lng: number;
    };
    categories?: string[] | undefined;
    radius?: number | undefined;
    excludeChains?: boolean | undefined;
}>;
export type ProspectorInput = z.infer<typeof ProspectorInputSchema>;
import type { ProspectResult } from "../schema.js";
export type { ProspectResult };
export interface ProspectorOutput {
    results: ProspectResult[];
    metadata: {
        query: string;
        companyContext: string;
        location: LatLng;
        radius: number;
        categories: string[];
        createdAt: string;
    };
}
export type ProspectorJobStatus = "queued" | "planning" | "searching" | "scoring" | "completed" | "failed";
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
export declare const ProspectorEventDataSchema: z.ZodObject<{
    jobId: z.ZodString;
    companyId: z.ZodString;
    userId: z.ZodString;
    query: z.ZodString;
    companyContext: z.ZodString;
    location: z.ZodUnion<[z.ZodObject<{
        lat: z.ZodNumber;
        lng: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        lat: number;
        lng: number;
    }, {
        lat: number;
        lng: number;
    }>, z.ZodString]>;
    radius: z.ZodNumber;
    categories: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    excludeChains: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    companyId: string;
    userId: string;
    jobId: string;
    query: string;
    companyContext: string;
    radius: number;
    location: string | {
        lat: number;
        lng: number;
    };
    categories?: string[] | undefined;
    excludeChains?: boolean | undefined;
}, {
    companyId: string;
    userId: string;
    jobId: string;
    query: string;
    companyContext: string;
    radius: number;
    location: string | {
        lat: number;
        lng: number;
    };
    categories?: string[] | undefined;
    excludeChains?: boolean | undefined;
}>;
export type ProspectorEventData = z.infer<typeof ProspectorEventDataSchema>;
//# sourceMappingURL=types.d.ts.map