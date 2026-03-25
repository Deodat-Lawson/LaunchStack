import { eq, and, desc } from "drizzle-orm";
import { db } from "~/server/db";
import { marketingContentHistory } from "~/server/db/schema";
import type { MarketingPlatform, ContentPerformanceRecord } from "~/lib/tools/marketing-pipeline/types";

export async function getPerformanceHistory(args: {
    companyId: number;
    platform?: MarketingPlatform;
    limit?: number;
}): Promise<ContentPerformanceRecord[]> {
    const { companyId, platform, limit: rowLimit = 10 } = args;

    try {
        const conditions = [eq(marketingContentHistory.companyId, BigInt(companyId))];
        if (platform) {
            conditions.push(eq(marketingContentHistory.platform, platform));
        }

        const rows = await db
            .select()
            .from(marketingContentHistory)
            .where(and(...conditions))
            .orderBy(desc(marketingContentHistory.createdAt))
            .limit(rowLimit);

        return rows.map((row) => ({
            content: row.content,
            platform: row.platform as MarketingPlatform,
            angle: row.angle ?? "",
            publishedAt: row.createdAt.toISOString(),
            metrics: row.metrics ?? undefined,
        }));
    } catch (error) {
        console.warn("[marketing-pipeline] performance history query failed:", error);
        return [];
    }
}

export function buildPerformanceInsights(
    history: ContentPerformanceRecord[],
): string[] {
    if (history.length === 0) return [];

    const insights: string[] = [];
    insights.push(`${history.length} previous campaign(s) found for this company.`);

    const withMetrics = history.filter((h) => h.metrics?.engagements);
    if (withMetrics.length > 0) {
        const sorted = [...withMetrics].sort(
            (a, b) => (b.metrics?.engagements ?? 0) - (a.metrics?.engagements ?? 0),
        );
        const best = sorted[0]!;
        if (best.angle) {
            insights.push(
                `Top-performing angle: "${best.angle}" (${best.metrics?.engagements ?? 0} engagements on ${best.platform}).`,
            );
        }
    }

    const angles = history
        .map((h) => h.angle)
        .filter(Boolean);
    if (angles.length > 0) {
        insights.push(`Recent angles used: ${angles.slice(0, 3).join("; ")}.`);
    }

    return insights;
}

export async function saveGeneratedContent(args: {
    companyId: number;
    userId: string;
    platform: MarketingPlatform;
    content: string;
    angle?: string;
    contentType?: string;
}): Promise<void> {
    try {
        await db.insert(marketingContentHistory).values({
            companyId: BigInt(args.companyId),
            userId: args.userId,
            platform: args.platform,
            content: args.content,
            angle: args.angle,
            contentType: args.contentType ?? "post",
        });
    } catch (error) {
        console.warn("[marketing-pipeline] failed to save content history:", error);
    }
}
