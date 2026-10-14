/**
 * Posts as `/api/brand/*` returns them: the stored row plus what the
 * calendar shows beside it (the channel's name and picture, the images'
 * same-origin URLs).
 */
import { and, eq, inArray } from "drizzle-orm";

import type {
    BrandPostMetrics,
    BrandPostRecord,
    BrandPostSource,
    BrandPostStatus,
} from "@launchstack/pipelines/marketing/posts";
import type { MarketingPlatform } from "@launchstack/tools/platform-profiles";

import { db } from "~/server/db";
import { brandChannels, type BrandChannelKind } from "~/server/db/schema/brand";

import { NETWORK_LABELS, parseDeploymentChannelId } from "./channels";
import { getBrandMediaRows, toMediaView, type BrandMediaView } from "./media";

export interface BrandPostView {
    id: string;
    platform: MarketingPlatform;
    channelId: string | null;
    channel: {
        id: string;
        name: string;
        kind: BrandChannelKind | "deployment";
        avatarUrl: string | null;
    } | null;
    body: string;
    title: string | null;
    status: BrandPostStatus;
    scheduledAt: Date | null;
    publishedAt: Date | null;
    postId: string | null;
    postUrl: string | null;
    error: string | null;
    source: BrandPostSource | null;
    media: BrandMediaView[];
    metrics: BrandPostMetrics | null;
    metricsAt: Date | null;
    createdAt: Date;
}

export async function toPostViews(
    companyId: bigint,
    posts: readonly BrandPostRecord[]
): Promise<BrandPostView[]> {
    const channelIds = [
        ...new Set(
            posts
                .map(p => p.channelId)
                .filter((id): id is string => id !== null && !parseDeploymentChannelId(id))
        ),
    ];
    const channels =
        channelIds.length > 0
            ? await db
                  .select({
                      id: brandChannels.id,
                      name: brandChannels.name,
                      kind: brandChannels.kind,
                      avatarUrl: brandChannels.avatarUrl,
                  })
                  .from(brandChannels)
                  .where(
                      and(
                          eq(brandChannels.companyId, companyId),
                          inArray(brandChannels.id, channelIds)
                      )
                  )
            : [];
    const channelById = new Map(channels.map(c => [c.id, c]));
    const mediaIds = [...new Set(posts.flatMap(p => p.media.map(m => m.id)))];
    const mediaById = new Map((await getBrandMediaRows(companyId, mediaIds)).map(m => [m.id, m]));

    return posts.map(post => {
        let channel: BrandPostView["channel"] = null;
        if (post.channelId === null || parseDeploymentChannelId(post.channelId)) {
            channel = {
                id: post.channelId ?? `deployment:${post.platform}`,
                name: `${NETWORK_LABELS[post.platform]} (deployment account)`,
                kind: "deployment",
                avatarUrl: null,
            };
        } else {
            const row = channelById.get(post.channelId);
            channel = row
                ? { id: row.id, name: row.name, kind: row.kind, avatarUrl: row.avatarUrl ?? null }
                : null;
        }
        return {
            id: post.id,
            platform: post.platform,
            channelId: post.channelId,
            channel,
            body: post.body,
            title: post.title,
            status: post.status,
            scheduledAt: post.scheduledAt,
            publishedAt: post.publishedAt,
            postId: post.postId,
            postUrl: post.postUrl,
            error: post.error,
            source: post.source,
            media: post.media.flatMap(ref => {
                const row = mediaById.get(ref.id);
                return row ? [toMediaView(row, ref.alt)] : [];
            }),
            metrics: post.metrics,
            metricsAt: post.metricsAt,
            createdAt: post.createdAt,
        };
    });
}
