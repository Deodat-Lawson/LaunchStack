import type { MarketingPlatform } from "./types.js";
interface HistoryRow {
    platform: string;
    message: string;
    angle: string | null;
    impressions: number | null;
    engagements: number | null;
    clicks: number | null;
}
export declare function getPerformanceHistory(args: {
    companyId: number;
    platform: MarketingPlatform;
    limit?: number;
}): Promise<HistoryRow[]>;
export declare function buildPerformanceInsights(history: HistoryRow[]): string[];
export declare function saveGeneratedContent(args: {
    companyId: number;
    platform: MarketingPlatform;
    message: string;
    angle?: string;
    contentType?: string;
}): Promise<void>;
export {};
//# sourceMappingURL=performance.d.ts.map