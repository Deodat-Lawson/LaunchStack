import { z } from "zod";
export { SearchCategoryEnum } from "@launchstack/tools/web-research";
export type { SearchCategory, PlannedQuery, RawSearchResult, } from "@launchstack/tools/web-research";
import type { SearchCategory } from "@launchstack/tools/web-research";
export declare const TrendSearchInputSchema: z.ZodObject<{
    query: z.ZodString;
    companyContext: z.ZodString;
    categories: z.ZodOptional<z.ZodArray<z.ZodEnum<["fashion", "finance", "business", "tech"]>, "many">>;
}, "strip", z.ZodTypeAny, {
    query: string;
    companyContext: string;
    categories?: ("fashion" | "finance" | "business" | "tech")[] | undefined;
}, {
    query: string;
    companyContext: string;
    categories?: ("fashion" | "finance" | "business" | "tech")[] | undefined;
}>;
export type TrendSearchInput = z.infer<typeof TrendSearchInputSchema>;
export interface SearchResult {
    sourceUrl: string;
    summary: string;
    description: string;
}
export interface TrendSearchOutput {
    results: SearchResult[];
    metadata: {
        query: string;
        companyContext: string;
        categories: SearchCategory[];
        createdAt: string;
    };
}
export type TrendSearchJobStatus = "queued" | "planning" | "searching" | "synthesizing" | "completed" | "failed";
export interface TrendSearchJobRecord {
    id: string;
    companyId: bigint;
    userId: string;
    status: TrendSearchJobStatus;
    input: TrendSearchInput;
    output: TrendSearchOutput | null;
    errorMessage: string | null;
    createdAt: Date;
    completedAt: Date | null;
}
export declare const TrendSearchEventDataSchema: z.ZodObject<{
    jobId: z.ZodString;
    companyId: z.ZodString;
    userId: z.ZodString;
    query: z.ZodString;
    companyContext: z.ZodString;
    categories: z.ZodOptional<z.ZodArray<z.ZodEnum<["fashion", "finance", "business", "tech"]>, "many">>;
}, "strip", z.ZodTypeAny, {
    companyId: string;
    query: string;
    userId: string;
    jobId: string;
    companyContext: string;
    categories?: ("fashion" | "finance" | "business" | "tech")[] | undefined;
}, {
    companyId: string;
    query: string;
    userId: string;
    jobId: string;
    companyContext: string;
    categories?: ("fashion" | "finance" | "business" | "tech")[] | undefined;
}>;
export type TrendSearchEventData = z.infer<typeof TrendSearchEventDataSchema>;
//# sourceMappingURL=types.d.ts.map