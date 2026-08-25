import type { PlannedQuery } from "./types.js";
import type { ProviderStrategy, SearchExecutionResult } from "./providers/types.js";
export declare function executeSearch(
    subQueries: PlannedQuery[],
    strategyOverride?: ProviderStrategy
): Promise<SearchExecutionResult>;
//# sourceMappingURL=web-search.d.ts.map
