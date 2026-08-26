import type { RawSearchResult, SearchCategory, SearchResult } from "./types.js";
/**
 * Synthesizes raw search results into up to 5 SearchResults (summary + description).
 * If fewer than 5 raw results exist or LLM returns fewer, pads with placeholder entries.
 */
export declare function synthesizeResults(rawResults: RawSearchResult[], query: string, companyContext: string, categories?: SearchCategory[]): Promise<SearchResult[]>;
//# sourceMappingURL=synthesizer.d.ts.map