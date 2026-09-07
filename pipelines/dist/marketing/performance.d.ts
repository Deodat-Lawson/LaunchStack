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
/**
 * Record a successful publish against the newest history row with the same
 * content (unification PR-6). Message-equality matching is best-effort: a
 * post edited after generation won't match and the write-back is skipped —
 * acceptable until history rows carry an id through the UI flow.
 */
export declare function markContentPublished(args: {
    companyId: number;
    platform: MarketingPlatform;
    message: string;
    postId?: string;
    postUrl?: string;
}): Promise<void>;
export {};
//# sourceMappingURL=performance.d.ts.map