/**
 * Stage 3 — gather. Executes the plan across the three sources with
 * allSettled semantics: a source that fails contributes nothing and is
 * reported; only all sources failing fails the stage (the caller decides).
 * Output is *mentions* — raw sightings of organisations — for the resolver.
 */
import type { OrgMention } from "@launchstack/tools/org-resolver";
import type { TradeDataProvider } from "@launchstack/tools/trade-data";
import type { RawSearchResult } from "@launchstack/tools/web-research";
import type { PlannedSourceQuery, SourceCount } from "./types.js";
export interface GatherPorts {
    /** Web search over planned queries; null when unavailable. */
    searchWeb: ((queries: PlannedSourceQuery[]) => Promise<RawSearchResult[]>) | null;
    /** Place search for one planned place query; null when unavailable. */
    searchPlaces: ((query: PlannedSourceQuery) => Promise<Array<{
        fsqId: string;
        name: string;
        website?: string;
        formattedAddress: string;
        location: {
            lat: number;
            lng: number;
        };
        categories: Array<{
            id: string;
            name: string;
        }>;
    }>>) | null;
    tradeData: TradeDataProvider | null;
    /** HS codes and keywords for trade queries. */
    hsCodes: string[];
    signal?: AbortSignal;
}
export interface GatherResult {
    mentions: OrgMention[];
    sources: SourceCount[];
    /** Search results kept so the enrich stage can seed candidate pages. */
    webResults: RawSearchResult[];
}
/** Which planned query produced a web result: keyed by URL. */
export interface MentionOrigin {
    query: PlannedSourceQuery;
}
/**
 * Turn a web search result into a mention. The result's own site is the
 * organisation when the page is a company page; directory and press pages
 * become mentions of whoever they name in the title. Deciding that is the
 * enrich agent's job; here we record what we saw.
 */
export declare function mentionFromWebResult(result: RawSearchResult, query: PlannedSourceQuery): OrgMention;
export declare function gather(plan: PlannedSourceQuery[], ports: GatherPorts): Promise<GatherResult>;
//# sourceMappingURL=gather.d.ts.map