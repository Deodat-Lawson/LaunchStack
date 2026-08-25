import type { PlannedQuery, TrendSearchInput, TrendSearchOutput } from "./types.js";
export type TrendSearchPipelineStage = "searching" | "synthesizing";
export interface RunTrendSearchOptions {
    onStageChange?: (stage: TrendSearchPipelineStage) => Promise<void> | void;
    /** Pre-built queries to skip the LLM planQueries step. */
    preBuiltQueries?: PlannedQuery[];
}
/**
 * Trend-search pipeline: planQueries → executeSearch → synthesizeResults.
 *
 * Pure pipeline execution — no DB writes, no side effects.
 * Callers (e.g. Inngest) own persistence and status tracking.
 */
export declare function runTrendSearch(
    input: TrendSearchInput,
    options?: RunTrendSearchOptions
): Promise<TrendSearchOutput>;
//# sourceMappingURL=run.d.ts.map
