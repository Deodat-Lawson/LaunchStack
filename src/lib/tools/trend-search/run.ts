import type {
  TrendSearchInput,
  TrendSearchOutput,
} from "~/lib/tools/trend-search/types";
import { planQueries } from "~/lib/tools/trend-search/query-planner";
import { executeSearch } from "~/lib/tools/trend-search/web-search";
import { synthesizeResults } from "~/lib/tools/trend-search/synthesizer";

export type TrendSearchPipelineStage = "searching" | "synthesizing";

export interface RunTrendSearchOptions {
    onStageChange?: (stage: TrendSearchPipelineStage) => Promise<void> | void;
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
  // Step 1: Plan queries
  const categories = input.categories;
  const plannedQueries = await planQueries(
    input.query,
    input.companyContext,
    categories,
  );

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
