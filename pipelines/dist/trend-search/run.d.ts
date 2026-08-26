import type { PipelineProgressEvent } from "@launchstack/tools/contract";
import type { PlannedQuery, TrendSearchInput, TrendSearchOutput } from "./types.js";
export type TrendSearchPipelineStage = "searching" | "synthesizing";
export interface RunTrendSearchOptions {
    onStageChange?: (stage: TrendSearchPipelineStage) => Promise<void> | void;
    /**
     * Shared progress protocol (unification P3, design D5) — a superset of
     * onStageChange with labels, durations, and statuses. Both callbacks fire;
     * adopt whichever granularity the caller needs.
     */
    onProgress?: (event: PipelineProgressEvent<TrendSearchPipelineStage>) => void;
    /** Pre-built queries to skip the LLM planQueries step. */
    preBuiltQueries?: PlannedQuery[];
}
/**
 * Trend-search pipeline: planQueries → executeSearch → synthesizeResults.
 *
 * Pure pipeline execution — no DB writes, no side effects.
 * Callers (e.g. Inngest) own persistence and status tracking.
 */
export declare function runTrendSearch(input: TrendSearchInput, options?: RunTrendSearchOptions): Promise<TrendSearchOutput>;
//# sourceMappingURL=run.d.ts.map