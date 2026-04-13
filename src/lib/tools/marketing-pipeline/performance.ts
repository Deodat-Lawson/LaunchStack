import { eq, and, desc } from "drizzle-orm";
import { db } from "~/server/db";
import { marketingContentHistory } from "~/server/db/schema/marketing-history";
import type { MarketingPlatform } from "~/lib/tools/marketing-pipeline/types";

interface HistoryRow {
    platform: string;
    message: string;
    angle: string | null;
    impressions: number | null;
    engagements: number | null;
    clicks: number | null;
}

export async function getPerformanceHistory(args: {
    companyId: number;
    platform: MarketingPlatform;
    limit?: number;
}): Promise<HistoryRow[]> {
    const rows = await db
        .select({
            platform: marketingContentHistory.platform,
            message: marketingContentHistory.message,
            angle: marketingContentHistory.angle,
            impressions: marketingContentHistory.impressions,
            engagements: marketingContentHistory.engagements,
            clicks: marketingContentHistory.clicks,
        })
        .from(marketingContentHistory)
        .where(
            and(
                eq(marketingContentHistory.companyId, BigInt(args.companyId)),
                eq(marketingContentHistory.platform, args.platform),
            ),
        )
        .orderBy(desc(marketingContentHistory.createdAt))
        .limit(args.limit ?? 10);

    return rows;
}

export function buildPerformanceInsights(history: HistoryRow[]): string[] {
    if (history.length === 0) return [];

    const withEngagement = history.filter((h) => h.engagements != null && h.impressions != null);
    const insights: string[] = [];

    insights.push(`${history.length} previous campaign(s) found for this platform.`);

    if (withEngagement.length > 0) {
        const avgRate =
            withEngagement.reduce((sum, h) => sum + (h.engagements! / Math.max(h.impressions!, 1)), 0) /
            withEngagement.length;
        insights.push(`Average engagement rate: ${(avgRate * 100).toFixed(1)}%`);

        const best = withEngagement.sort(
            (a, b) => (b.engagements! / Math.max(b.impressions!, 1)) - (a.engagements! / Math.max(a.impressions!, 1)),
        )[0];
        if (best?.angle) {
            insights.push(`Best performing angle: "${best.angle}"`);
        }
    }

    const angles = history.map((h) => h.angle).filter(Boolean);
    if (angles.length > 0) {
        insights.push(`Previously used angles: ${angles.slice(0, 3).join("; ")}`);
    }

    return insights;
}

export async function saveGeneratedContent(args: {
    companyId: number;
    platform: MarketingPlatform;
    message: string;
    angle?: string;
    contentType?: string;
    sourceDocumentIds?: number[];
}): Promise<void> {
    await db.insert(marketingContentHistory).values({
        companyId: BigInt(args.companyId),
        platform: args.platform,
        message: args.message,
        angle: args.angle ?? null,
        contentType: args.contentType ?? "post",
        metadata: args.sourceDocumentIds?.length
            ? { sourceDocumentIds: args.sourceDocumentIds }
            : null,
    });
}
