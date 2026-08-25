import type { MarketingPlatform, MarketingResearchResult } from "./types.js";
export declare function researchPlatformTrends(args: {
    platform: MarketingPlatform;
    prompt: string;
    companyName: string;
    companyContext: string;
    companyIndustry?: string;
    maxResults: number;
}): Promise<MarketingResearchResult[]>;
//# sourceMappingURL=research.d.ts.map
