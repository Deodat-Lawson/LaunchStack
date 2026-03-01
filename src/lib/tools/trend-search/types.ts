import { z } from "zod";

// ─── Category ────────────────────────────────────────────────────────────────

export const SearchCategoryEnum = z.enum([
    "fashion",
    "finance",
    "business",
    "tech",
]);
export type SearchCategory = z.infer<typeof SearchCategoryEnum>;

// ─── Input ───────────────────────────────────────────────────────────────────

export const TrendSearchInputSchema = z.object({
    query: z.string().min(1).max(1000),
    companyContext: z.string().min(1).max(2000),
    categories: z.array(SearchCategoryEnum).optional(),
});
export type TrendSearchInput = z.infer<typeof TrendSearchInputSchema>;

// ─── Results ─────────────────────────────────────────────────────────────────

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

// ─── Job ─────────────────────────────────────────────────────────────────────

export type TrendSearchJobStatus =
    | "queued"
    | "planning"
    | "searching"
    | "synthesizing"
    | "completed"
    | "failed";

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

// ─── Inngest event payload ────────────────────────────────────────────────────

export const TrendSearchEventDataSchema = z.object({
    jobId: z.string(),
    companyId: z.string(), // serialized as string for Inngest
    userId: z.string(),
    query: z.string(),
    companyContext: z.string(),
    categories: z.array(SearchCategoryEnum).optional(),
});
export type TrendSearchEventData = z.infer<typeof TrendSearchEventDataSchema>;

// ─── Query Planner ───────────────────────────────────────────────────────────

export interface PlannedQuery {
    searchQuery: string;
    category: SearchCategory;
    rationale: string;
}

// ─── Web Search ──────────────────────────────────────────────────────────────

export interface RawSearchResult {
    url: string;
    title: string;
    content: string;
    score: number;
    publishedDate?: string;
}
