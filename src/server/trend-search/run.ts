import type { TrendSearchInput, TrendSearchOutput } from "~/server/trend-search/types";

export type TrendSearchPipelineStage = "searching" | "synthesizing";

export interface RunTrendSearchOptions {
    onStageChange?: (stage: TrendSearchPipelineStage) => Promise<void> | void;
}

/**
 * Trend-search pipeline contract.
 *
 * The pipeline owns planning/search/synthesis. It reports progress via callbacks,
 * while callers (e.g. Inngest) own persistence and status tracking.
 *
 * TODO: Replace this placeholder with the real trend-search pipeline implementation.
 */
export async function runTrendSearch(
    input: TrendSearchInput,
    options: RunTrendSearchOptions = {}
): Promise<TrendSearchOutput> {
    await options.onStageChange?.("searching");
    await options.onStageChange?.("synthesizing");

    throw new Error(
        `runTrendSearch() is not implemented yet (query=${JSON.stringify(input.query).slice(0, 120)}). ` +
            "Add the planner/search/synthesis pipeline to src/server/trend-search/run.ts."
    );
}
