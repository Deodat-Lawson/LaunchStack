import type { PlannedSearch } from "./types.js";
/**
 * Plans 2-4 Foursquare search parameter sets from a user prompt and company context.
 * When categories are omitted, the LLM infers them; when provided, only those are used.
 */
export declare function planSearches(query: string, companyContext: string, categories?: string[]): Promise<PlannedSearch[]>;
//# sourceMappingURL=query-planner.d.ts.map