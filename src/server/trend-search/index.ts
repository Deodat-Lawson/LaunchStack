/**
 * Public entry point for the AI Trend Search Engine module.
 *
 * This is the interface for programmatic invocation (agent-callable in the future).
 * The pipeline is stateless — no DB writes, no side effects.
 * Persistence is the responsibility of the caller (e.g. Inngest function).
 */
export { runTrendSearch } from "~/server/trend-search/run";
export type { RunTrendSearchOptions, TrendSearchPipelineStage } from "~/server/trend-search/run";
export type {
    TrendSearchInput,
    TrendSearchOutput,
    SearchResult,
    SearchCategory,
} from "~/server/trend-search/types";
