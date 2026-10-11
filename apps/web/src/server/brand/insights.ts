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
    for (const c of channels) {
        if (!c.capabilities.analytics && c.kind !== "deployment") continue;
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
        const key = post.channel?.id ?? `deployment:${post.platform}`;
        let row = byId.get(key);
        if (!row) {
            row = {
                channelId: key,
                platform: post.platform,
                kind: post.channel?.kind ?? "deployment",
                name: post.channel?.name ?? "Disconnected channel",
                avatarUrl: post.channel?.avatarUrl ?? null,
                followers: null,
                posts: 0,
                impressions: 0,
                reactions: 0,
                comments: 0,
                shares: 0,
                clicks: 0,
            };
            byId.set(key, row);
        }
        row.posts += 1;
        const m = post.metrics;
        if (!m) continue;
        row.impressions += m.impressions ?? 0;
        row.reactions += m.reactions;
        row.comments += m.comments;
        row.shares += m.shares;
        row.clicks += m.clicks ?? 0;
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
        channels: [...byId.values()].filter(
            c => c.posts > 0 || c.followers !== null || c.kind !== "deployment"
        ),
        posts,
        syncedAt: synced.length > 0 ? new Date(Math.max(...synced)) : null,
    };
}
