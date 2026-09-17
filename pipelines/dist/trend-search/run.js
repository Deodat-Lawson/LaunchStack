import { executeSearch } from "@launchstack/tools/web-research";
import { planQueries } from "./query-planner.js";
import { synthesizeResults } from "./synthesizer.js";
const STAGE_LABELS = {
    searching: "Searching the web",
    synthesizing: "Synthesizing results",
};
/**
 * Trend-search pipeline: planQueries → executeSearch → synthesizeResults.
 *
 * Pure pipeline execution — no DB writes, no side effects.
 * Callers (e.g. Inngest) own persistence and status tracking.
 */
export async function runTrendSearch(input, options = {}) {
    const categories = input.categories;
    const plannedQueries = options.preBuiltQueries ??
        (await planQueries(input.query, input.companyContext, categories));
    // Step 2: Execute web searches
    await options.onStageChange?.("searching");
    options.onProgress?.({ type: "step_start", step: "searching", label: STAGE_LABELS.searching });
    const searchStart = Date.now();
    const { results: rawResults, providerUsed } = await executeSearch(plannedQueries);
    console.log(`[trend-search] Search provider used: ${providerUsed}`);
    options.onProgress?.({
        type: "step_complete",
        step: "searching",
        durationMs: Date.now() - searchStart,
        detail: `${rawResults.length} result${rawResults.length !== 1 ? "s" : ""} via ${providerUsed}`,
        status: "completed",
    });
    // Step 3: Synthesize results
    await options.onStageChange?.("synthesizing");
    options.onProgress?.({
        type: "step_start",
        step: "synthesizing",
        label: STAGE_LABELS.synthesizing,
    });
    const synthStart = Date.now();
    const resolvedCategories = categories ?? [...new Set(plannedQueries.map(q => q.category))];
    const results = await synthesizeResults(rawResults, input.query, input.companyContext, resolvedCategories);
    options.onProgress?.({
        type: "step_complete",
        step: "synthesizing",
        durationMs: Date.now() - synthStart,
        detail: `${results.length} trend${results.length !== 1 ? "s" : ""}`,
        status: "completed",
    });
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
//# sourceMappingURL=run.js.map