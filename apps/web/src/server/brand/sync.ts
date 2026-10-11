/**
 * Reading back from the networks: each published post's numbers, each
 * channel's followers, and the comments on recent posts. Runs every few
 * hours from the worker and when someone presses "Sync now".
 *
 * Budget: a LinkedIn app in the Community Management development tier gets
 * 500 calls a day. One sync of one Page costs 1 (followers) + 1 per 20 posts
 * (numbers) + 1 per post read for comments, so posts are limited to the
 * last 90 days for numbers and the last 30 days (at most 20) for comments.
 */
import { randomUUID } from "node:crypto";

import { and, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";

import {
    brandPosts,
    type BrandPostMetrics,
    type BrandPostRow,
} from "@launchstack/pipelines/schema";
import {
    getBlueskyPostStats,
    getBlueskyProfile,
    listBlueskyReplies,
    type BlueskyPostStats,
} from "@launchstack/tools/social-publish/bluesky";
import {
    getOrganizationFollowerCount,
    getOrganizationPostStats,
    listLinkedInComments,
    LinkedInApiError,
} from "@launchstack/tools/social-publish/linkedin";

import { db } from "~/server/db";
import { brandChannels, brandComments, type BrandChannelRow } from "~/server/db/schema/brand";

import {
    ChannelUnavailableError,
    listChannelRows,
    markConnectionReconnect,
    resolveChannelTarget,
} from "./channels";
import { linkedInApiOptions } from "./linkedin-options";

const DAY = 86_400_000;
const METRICS_WINDOW_DAYS = 90;
const COMMENTS_WINDOW_DAYS = 30;
const COMMENTS_MAX_POSTS = 20;

export interface SyncSummary {
    syncedAt: Date;
    posts: number;
    comments: number;
    errors: string[];
}

interface CommentSeed {
    externalId: string;
    parentExternalId: string | null;
    refs: { cid?: string; rootUri?: string; rootCid?: string } | null;
    authorExternalId: string | null;
    authorName: string | null;
    authorHandle: string | null;
    body: string;
    commentedAt: Date;
}

async function publishedPostsFor(
    channel: BrandChannelRow,
    sinceDays: number,
    limit: number
): Promise<BrandPostRow[]> {
    return db
        .select()
        .from(brandPosts)
        .where(
            and(
                eq(brandPosts.companyId, channel.companyId),
                eq(brandPosts.channelId, channel.id),
                eq(brandPosts.status, "published"),
                isNotNull(brandPosts.postId),
                gte(brandPosts.publishedAt, new Date(Date.now() - sinceDays * DAY))
            )
        )
        .orderBy(desc(brandPosts.publishedAt))
        .limit(limit);
}

async function saveMetrics(
    posts: BrandPostRow[],
    metricsFor: (post: BrandPostRow) => BrandPostMetrics | null,
    now: Date
): Promise<number> {
    let updated = 0;
    for (const post of posts) {
        const metrics = metricsFor(post);
        if (!metrics) continue;
        await db
            .update(brandPosts)
            .set({ metrics, metricsAt: now })
            .where(eq(brandPosts.id, post.id));
        updated += 1;
    }
    return updated;
}

/** Store comments; returns how many were new. A comment already stored keeps its done state. */
async function saveComments(
    channel: BrandChannelRow,
    post: BrandPostRow,
    seeds: CommentSeed[]
): Promise<number> {
    if (seeds.length === 0) return 0;
    const rows = await db
        .insert(brandComments)
        .values(
            seeds.map(seed => ({
                id: randomUUID(),
                companyId: channel.companyId,
                channelId: channel.id,
                postId: post.id,
                platform: channel.platform,
                externalId: seed.externalId,
                parentExternalId: seed.parentExternalId,
                refs: seed.refs,
                authorExternalId: seed.authorExternalId,
                authorName: seed.authorName,
                authorHandle: seed.authorHandle,
                body: seed.body,
                isOwn: seed.authorExternalId === channel.externalId,
                commentedAt: seed.commentedAt,
                // What the channel itself wrote needs no answer.
                handledAt: seed.authorExternalId === channel.externalId ? seed.commentedAt : null,
            }))
        )
        // Seen before: keep its done state, but take the network's latest
        // wording and the author's name if it has one now.
        .onConflictDoUpdate({
            target: [brandComments.channelId, brandComments.externalId],
            set: {
                body: sql`excluded.body`,
                authorName: sql`coalesce(excluded.author_name, ${brandComments.authorName})`,
                authorHandle: sql`coalesce(excluded.author_handle, ${brandComments.authorHandle})`,
            },
        })
        .returning({ id: brandComments.id, inserted: sql<boolean>`(xmax = 0)` });
    return rows.filter(r => r.inserted).length;
}

async function syncLinkedInPage(
    channel: BrandChannelRow,
    accessToken: string,
    now: Date
): Promise<{ posts: number; comments: number }> {
    const options = linkedInApiOptions(accessToken);
    let posts = 0;
    let comments = 0;
    if (channel.capabilities.analytics) {
        const followers = await getOrganizationFollowerCount({
            ...options,
            organizationUrn: channel.externalId,
        });
        if (followers !== null) {
            await db
                .update(brandChannels)
                .set({ followers })
                .where(eq(brandChannels.id, channel.id));
        }
        const published = await publishedPostsFor(channel, METRICS_WINDOW_DAYS, 200);
        if (published.length > 0) {
            const stats = await getOrganizationPostStats({
                ...options,
                organizationUrn: channel.externalId,
                postUrns: published.map(p => p.postId!),
            });
            posts = await saveMetrics(
                published,
                post => {
                    const s = stats.get(post.postId!);
                    // LinkedIn leaves out posts nobody has seen yet.
                    if (!s)
                        return {
                            impressions: 0,
                            reactions: 0,
                            comments: 0,
                            shares: 0,
                            clicks: 0,
                            engagement: null,
                        };
                    return {
                        impressions: s.impressions,
                        reactions: s.reactions,
                        comments: s.comments,
                        shares: s.shares,
                        clicks: s.clicks,
                        engagement: s.engagement,
                    };
                },
                now
            );
        }
    }
    if (channel.capabilities.comments) {
        for (const post of await publishedPostsFor(
            channel,
            COMMENTS_WINDOW_DAYS,
            COMMENTS_MAX_POSTS
        )) {
            const list = await listLinkedInComments({
                ...options,
                postUrn: post.postId!,
                count: 50,
            });
            comments += await saveComments(
                channel,
                post,
                list.map(c => ({
                    externalId: c.urn,
                    parentExternalId: c.parentCommentUrn,
                    refs: null,
                    authorExternalId: c.actorUrn,
                    authorName: c.actorName,
                    authorHandle: null,
                    body: c.text,
                    commentedAt: c.createdAt,
                }))
            );
        }
    }
    return { posts, comments };
}

async function syncBlueskyAccount(
    channel: BrandChannelRow,
    now: Date
): Promise<{ posts: number; comments: number }> {
    let comments = 0;
    const profile = await getBlueskyProfile(channel.externalId);
    if (profile.followers !== null) {
        await db
            .update(brandChannels)
            .set({ followers: profile.followers })
            .where(eq(brandChannels.id, channel.id));
    }
    const published = await publishedPostsFor(channel, METRICS_WINDOW_DAYS, 200);
    const stats = new Map<string, BlueskyPostStats>();
    for (let i = 0; i < published.length; i += 25) {
        const chunk = await getBlueskyPostStats(published.slice(i, i + 25).map(p => p.postId!));
        for (const [uri, value] of chunk) stats.set(uri, value);
    }
    const posts = await saveMetrics(
        published,
        post => {
            const s = stats.get(post.postId!);
            if (!s) return null;
            return {
                impressions: null,
                reactions: s.likes,
                comments: s.replies,
                shares: s.reposts + s.quotes,
                clicks: null,
                engagement: null,
            };
        },
        now
    );
    for (const post of published.slice(0, COMMENTS_MAX_POSTS)) {
        if (
            !post.publishedAt ||
            post.publishedAt.getTime() < now.getTime() - COMMENTS_WINDOW_DAYS * DAY
        )
            continue;
        const replies = await listBlueskyReplies(post.postId!);
        comments += await saveComments(
            channel,
            post,
            replies.map(r => ({
                externalId: r.uri,
                parentExternalId: r.parent.uri === post.postId ? null : r.parent.uri,
                refs: { cid: r.cid, rootUri: r.root.uri, rootCid: r.root.cid },
                authorExternalId: r.authorDid,
                authorName: r.authorName,
                authorHandle: r.authorHandle,
                body: r.text,
                commentedAt: r.createdAt,
            }))
        );
    }
    return { posts, comments };
}

/** Read one channel back; errors become one line in the summary, never a thrown sync. */
async function syncChannel(
    channel: BrandChannelRow,
    now: Date
): Promise<{ posts: number; comments: number; error: string | null }> {
    if (!channel.capabilities.analytics && !channel.capabilities.comments) {
        return { posts: 0, comments: 0, error: null };
    }
    try {
        let out: { posts: number; comments: number };
        if (channel.platform === "linkedin") {
            const target = await resolveChannelTarget(channel);
            if (target.kind !== "linkedin") return { posts: 0, comments: 0, error: null };
            out = await syncLinkedInPage(channel, target.accessToken, now);
        } else if (channel.platform === "bluesky") {
            out = await syncBlueskyAccount(channel, now);
        } else {
            return { posts: 0, comments: 0, error: null };
        }
        await db
            .update(brandChannels)
            .set({ syncedAt: now })
            .where(eq(brandChannels.id, channel.id));
        return { ...out, error: null };
    } catch (error) {
        if (error instanceof LinkedInApiError && error.authFailed) {
            await markConnectionReconnect(
                channel.connectionId,
                `LinkedIn refused the sign-in for ${channel.name}. Reconnect it under Accounts.`
            );
        }
        const message =
            error instanceof ChannelUnavailableError || error instanceof Error
                ? error.message
                : String(error);
        return { posts: 0, comments: 0, error: `${channel.name}: ${message}` };
    }
}

export async function syncBrandWorkspace(
    companyId: bigint,
    now = new Date()
): Promise<SyncSummary> {
    const channels = (await listChannelRows(companyId)).filter(c => c.status === "active");
    const summary: SyncSummary = { syncedAt: now, posts: 0, comments: 0, errors: [] };
    for (const channel of channels) {
        const result = await syncChannel(channel, now);
        summary.posts += result.posts;
        summary.comments += result.comments;
        if (result.error) summary.errors.push(result.error);
    }
    return summary;
}

/** Every workspace with an active channel that reads back; the worker's cron. */
export async function syncAllBrandWorkspaces(
    now = new Date()
): Promise<{ workspaces: number; errors: number }> {
    const rows = await db
        .selectDistinct({ companyId: brandChannels.companyId })
        .from(brandChannels)
        .where(
            and(
                eq(brandChannels.status, "active"),
                inArray(brandChannels.platform, ["linkedin", "bluesky"])
            )
        );
    let errors = 0;
    for (const row of rows) {
        const summary = await syncBrandWorkspace(row.companyId, now);
        errors += summary.errors.length;
    }
    return { workspaces: rows.length, errors };
}
