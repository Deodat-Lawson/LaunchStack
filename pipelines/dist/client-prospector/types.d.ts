import { z } from "zod";
export declare const LatLngSchema: z.ZodObject<{
    lat: z.ZodNumber;
    lng: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    lat: number;
    lng: number;
}, {
    lat: number;
    lng: number;
}>;
export type LatLng = z.infer<typeof LatLngSchema>;
export declare const SearchLocationSchema: z.ZodUnion<[z.ZodObject<{
    lat: z.ZodNumber;
    lng: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    lat: number;
    lng: number;
}, {
    lat: number;
    lng: number;
}>, z.ZodString]>;
export type SearchLocation = z.infer<typeof SearchLocationSchema>;
export declare const DEFAULT_SEARCH_RADIUS = 5000;
export declare const MAX_SEARCH_RADIUS = 50000;
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
export declare const FoursquareCategoryIdSchema: z.ZodString;
export interface PlannedSearch {
    searchQuery: string;
    categoryIds: string[];
    rationale: string;
}
export interface RawPlaceResult {
    fsqId: string;
    name: string;
    address: string;
    formattedAddress: string;
    location: LatLng;
    categories: Array<{
        id: string;
        name: string;
    }>;
    phone?: string;
    website?: string;
    rating?: number;
    totalRatings?: number;
    description?: string;
    verified?: boolean;
    distance?: number;
}
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