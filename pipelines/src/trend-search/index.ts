/**
 * Public entry point for the AI Trend Search Engine module.
 *
 * This is the interface for programmatic invocation (agent-callable in the future).
 * The pipeline is stateless — no DB writes, no side effects.
 * Persistence is the responsibility of the caller (e.g. Inngest function).
 */
export { runTrendSearch } from "./run";
export type { RunTrendSearchOptions, TrendSearchPipelineStage } from "./run";

// Re-export the full types surface so consumers can import from
// @launchstack/features/trend-search directly rather than a subpath.
export * from "./types";
