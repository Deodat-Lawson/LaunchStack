/**
 * Public entry point for the AI Trend Search Engine module.
 *
 * This is the interface for programmatic invocation (agent-callable in the future).
 * The pipeline is stateless — no DB writes, no side effects.
 * Persistence is the responsibility of the caller (e.g. Inngest function).
 */
export { runTrendSearch } from "~/lib/tools/trend-search/run";
export type { RunTrendSearchOptions, TrendSearchPipelineStage } from "~/lib/tools/trend-search/run";
export type {
    PlannedQuery,
    TrendSearchInput,
    TrendSearchOutput,
    SearchResult,
    SearchCategory,
} from "~/lib/tools/trend-search/types";
