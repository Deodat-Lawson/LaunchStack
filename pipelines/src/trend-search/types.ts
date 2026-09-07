import { z } from "zod";

// ─── Category (moved to @launchstack/tools/web-research, PR-3; re-exported) ──

export { SearchCategoryEnum } from "@launchstack/tools/web-research";
export type {
    SearchCategory,
    PlannedQuery,
    RawSearchResult,
} from "@launchstack/tools/web-research";
import { SearchCategoryEnum } from "@launchstack/tools/web-research";
import type { SearchCategory } from "@launchstack/tools/web-research";

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

// PlannedQuery and RawSearchResult moved to @launchstack/tools/web-research
// (re-exported above).
