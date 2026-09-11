import type { ProspectResult, RawPlaceResult } from "./types.js";
/**
 * Scores and ranks raw place results, returning up to 10 ProspectResults.
 *
 * - Uses an LLM to evaluate relevance to the user's query and company
 * - Each result gets a relevanceScore (0-100) and rationale
 * - Results are ranked by relevanceScore descending
 * - If fewer than 10 raw results, scores all available (no padding)
 * - Returns empty array if no raw places are provided
 */
export declare function scoreLeads(rawPlaces: RawPlaceResult[], query: string, companyContext: string, categories: string[]): Promise<ProspectResult[]>;
//# sourceMappingURL=scorer.d.ts.map