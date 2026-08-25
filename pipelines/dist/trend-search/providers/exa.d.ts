import type { RawSearchResult } from "../types.js";
/**
 * Calls Exa search API for a single query. Uses `auto` search type (hybrid
 * neural + keyword) with the `news` category and full text contents so results
 * are directly usable for grounding.
 */
export declare function callExa(query: string): Promise<RawSearchResult[]>;
//# sourceMappingURL=exa.d.ts.map
