import type { PlannedQuery, SearchCategory } from "./types.js";
/**
 * Plans 3-5 search sub-queries from a user prompt and company context.
 * When categories are omitted, the LLM infers them; when provided, only those categories are used.
 */
export declare function planQueries(
    query: string,
    companyContext: string,
    categories?: SearchCategory[]
): Promise<PlannedQuery[]>;
//# sourceMappingURL=query-planner.d.ts.map
