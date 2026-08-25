import type { RawSearchResult } from "../types.js";
/**
 * Calls Serper.dev Google News API for a single query.
 * @returns RawSearchResult[] or empty array if SERPER_API_KEY not set; throws on non-2xx.
 */
export declare function callSerper(query: string): Promise<RawSearchResult[]>;
//# sourceMappingURL=serper.d.ts.map
