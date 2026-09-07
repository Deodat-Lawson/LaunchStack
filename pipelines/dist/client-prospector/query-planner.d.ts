import type { PlannedSearch } from "./types.js";
export declare const PROSPECTOR_PERSPECTIVE = "CONTEXT: The user's company wants to find POTENTIAL CLIENTS \u2014 businesses they can sell their services to. Your job is to generate Foursquare search queries that find those TARGET businesses, NOT businesses similar to the user's own company.\n\nExample: If the user is a \"digital marketing agency looking for restaurant clients\", you should search for RESTAURANTS, not marketing agencies. The restaurants are the prospects.";
/**
 * Plans 2-4 Foursquare search parameter sets from a user prompt and company context.
 * When categories are omitted, the LLM infers them; when provided, only those are used.
 */
export declare function planSearches(query: string, companyContext: string, categories?: string[]): Promise<PlannedSearch[]>;
//# sourceMappingURL=query-planner.d.ts.map