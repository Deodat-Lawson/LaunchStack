import type {
  PlannedQuery,
  TrendSearchInput,
  TrendSearchOutput,
} from "./types";
import { planQueries } from "./query-planner";
import { executeSearch } from "./web-search";
import { synthesizeResults } from "./synthesizer";

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
export async function runTrendSearch(
  input: TrendSearchInput,
  options: RunTrendSearchOptions = {},
): Promise<TrendSearchOutput> {
  const categories = input.categories;
  const plannedQueries = options.preBuiltQueries
    ?? await planQueries(input.query, input.companyContext, categories);

  // Step 2: Execute web searches
  await options.onStageChange?.("searching");
  const { results: rawResults, providerUsed } = await executeSearch(
    plannedQueries,
  );
  console.log(`[trend-search] Search provider used: ${providerUsed}`);

  // Step 3: Synthesize results
  await options.onStageChange?.("synthesizing");
  const resolvedCategories =
    categories ?? [...new Set(plannedQueries.map((q) => q.category))];
  const results = await synthesizeResults(
    rawResults,
    input.query,
    input.companyContext,
    resolvedCategories,
  );

  return {
    results,
    metadata: {
      query: input.query,
      companyContext: input.companyContext,
      categories: resolvedCategories,
      createdAt: new Date().toISOString(),
    },
  };
}
