/**
 * The Analytics screen's numbers: what the last sync read back for posts
 * published in the window, summed per channel and overall. Reads only the
 * database — the networks are asked by `sync.ts`.
 */
import { listBrandPosts } from "@launchstack/pipelines/marketing/posts";
import type { MarketingPlatform } from "@launchstack/tools/platform-profiles";

import { listBrandChannels } from "./accounts";
import { listChannelRows } from "./channels";
import { toPostViews, type BrandPostView } from "./post-views";

const DAY = 86_400_000;

export interface InsightsChannelView {
    channelId: string;
    platform: MarketingPlatform;
    kind: string;
    name: string;
    avatarUrl: string | null;
    followers: number | null;
    posts: number;
    impressions: number;
    reactions: number;
    comments: number;
    shares: number;
    clicks: number;
}

export interface BrandInsightsView {
    from: Date;
    to: Date;
    totals: {
        posts: number;
        impressions: number;
        reactions: number;
        comments: number;
        shares: number;
        clicks: number;
        engagement: number | null;
    };
    channels: InsightsChannelView[];
    posts: BrandPostView[];
    syncedAt: Date | null;
}

export async function getBrandInsights(
    companyId: bigint,
    days: number,
    now = new Date()
): Promise<BrandInsightsView> {
    const from = new Date(now.getTime() - days * DAY);
    const records = (
        await listBrandPosts({
            companyId,
            from,
            to: new Date(now.getTime() + 60_000),
            statuses: ["published"],
            limit: 1000,
        })
    ).filter(p => p.publishedAt && p.publishedAt.getTime() >= from.getTime());
    records.sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0));
    const posts = await toPostViews(companyId, records);

    const channels = await listBrandChannels(companyId);
    const byId = new Map<string, InsightsChannelView>();
    // A row per channel that reports numbers. Posts on the others (a Page the
    // member only content-admins, a profile, the deployment's account) still
    // count in totals.posts and list with metrics null, never as zeros.
    for (const c of channels) {
        if (!c.capabilities.analytics) continue;
        byId.set(c.id, {
            channelId: c.id,
            platform: c.platform,
            kind: c.kind,
            name: c.name,
            avatarUrl: c.avatarUrl,
            followers: c.followers,
            posts: 0,
            impressions: 0,
            reactions: 0,
            comments: 0,
            shares: 0,
            clicks: 0,
        });
    }

    const totals = { posts: 0, impressions: 0, reactions: 0, comments: 0, shares: 0, clicks: 0 };
    let engagementSum = 0;
    let engagementCount = 0;
    for (const post of posts) {
        totals.posts += 1;
        const row = post.channel ? byId.get(post.channel.id) : undefined;
        if (row) row.posts += 1;
        const m = post.metrics;
        if (!m) continue;
        if (row) {
            row.impressions += m.impressions ?? 0;
            row.reactions += m.reactions;
            row.comments += m.comments;
            row.shares += m.shares;
            row.clicks += m.clicks ?? 0;
        }
        totals.impressions += m.impressions ?? 0;
        totals.reactions += m.reactions;
        totals.comments += m.comments;
        totals.shares += m.shares;
        totals.clicks += m.clicks ?? 0;
        if (m.engagement !== null) {
            engagementSum += m.engagement;
            engagementCount += 1;
        }
    }

    const rows = await listChannelRows(companyId);
    const synced = rows.map(r => r.syncedAt?.getTime() ?? 0).filter(t => t > 0);
    return {
        from,
        to: now,
        totals: {
            ...totals,
            engagement: engagementCount > 0 ? engagementSum / engagementCount : null,
        },
        channels: [...byId.values()],
        posts,
        syncedAt: synced.length > 0 ? new Date(Math.max(...synced)) : null,
    };
}
