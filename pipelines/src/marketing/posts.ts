/**
 * Brand posts: what the Brand area composes, schedules and publishes. The
 * adapters in @launchstack/tools/social-publish do the posting; this module
 * owns the rows and the one rule that keeps two schedulers from posting the
 * same thing twice: a post is claimed with a single conditional update
 * (draft | scheduled | failed → publishing) before any network is called.
 */
import { randomUUID } from "node:crypto";

import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";

import { getDb } from "@launchstack/store/client";
import {
    MarketingPlatformEnum,
    PLATFORM_PROFILES,
    type MarketingPlatform,
} from "@launchstack/tools/platform-profiles";
import { publishToPlatform, type PublishResult } from "@launchstack/tools/social-publish";

import {
    BRAND_POST_STATUSES,
    brandPosts,
    type BrandPostMediaRef,
    type BrandPostMetrics,
    type BrandPostRow,
    type BrandPostSource,
    type BrandPostStatus,
} from "./schema";

export { BRAND_POST_STATUSES, MarketingPlatformEnum };
export type { BrandPostMediaRef, BrandPostMetrics, BrandPostSource, BrandPostStatus };

/** Tries before a post that keeps hitting rate limits or outages is marked failed. */
export const MAX_PUBLISH_ATTEMPTS = 4;

export interface BrandPostRecord {
    id: string;
    companyId: bigint;
    createdByUserId: string;
    platform: MarketingPlatform;
    body: string;
    title: string | null;
    status: BrandPostStatus;
    scheduledAt: Date | null;
    publishedAt: Date | null;
    postId: string | null;
    postUrl: string | null;
    error: string | null;
    source: BrandPostSource | null;
    createdAt: Date;
    updatedAt: Date | null;
    /** The workspace channel it goes out as; null = the deployment's account for the network. */
    channelId: string | null;
    media: BrandPostMediaRef[];
    metrics: BrandPostMetrics | null;
    metricsAt: Date | null;
    attempts: number;
}

/** Expected outcomes carry their own status; routes pass them through. */
export class BrandPostError extends Error {
    constructor(
        message: string,
        readonly status: number,
        readonly code: string
    ) {
        super(message);
        this.name = "BrandPostError";
    }
}

/**
 * What each network accepts, for Compose to enforce before saving. The
 * publish profiles only carry the limits they truncate at; LinkedIn and
 * Reddit reject over-long posts outright, so their published limits go here.
 */
const NETWORK_LIMITS: Record<MarketingPlatform, number | null> = {
    x: PLATFORM_PROFILES.x.hardCharLimit ?? 280,
    bluesky: PLATFORM_PROFILES.bluesky.hardCharLimit ?? 300,
    linkedin: PLATFORM_PROFILES.linkedin.hardCharLimit ?? 3000,
    reddit: PLATFORM_PROFILES.reddit.hardCharLimit ?? 40_000,
};

/** The network's post limit; null only if a network has none. */
export function platformLimit(platform: MarketingPlatform): number | null {
    return NETWORK_LIMITS[platform];
}

/** Why a body cannot go to a network, in the user's words; null when it can. */
export function bodyProblem(platform: MarketingPlatform, body: string): string | null {
    const text = body.trim();
    if (!text) return "Write something first.";
    const limit = platformLimit(platform);
    if (limit !== null && text.length > limit)
        return `${text.length.toLocaleString()} characters is over ${platformLabel(platform)}'s limit of ${limit.toLocaleString()}.`;
    return null;
}

/** A Reddit title, trimmed; null when there is nothing to keep. */
function cleanTitle(title: string | null | undefined): string | null {
    const trimmed = title?.trim();
    if (!trimmed) return null;
    return trimmed;
}

export function platformLabel(platform: MarketingPlatform): string {
    switch (platform) {
        case "x":
            return "X";
        case "linkedin":
            return "LinkedIn";
        case "bluesky":
            return "Bluesky";
        case "reddit":
            return "Reddit";
    }
}

function toRecord(row: BrandPostRow): BrandPostRecord {
    return {
        id: row.id,
        companyId: row.companyId,
        createdByUserId: row.createdByUserId,
        platform: MarketingPlatformEnum.parse(row.platform),
        body: row.body,
        title: row.title ?? null,
        status: row.status,
        scheduledAt: row.scheduledAt ?? null,
        publishedAt: row.publishedAt ?? null,
        postId: row.postId ?? null,
        postUrl: row.postUrl ?? null,
        error: row.error ?? null,
        source: row.source ?? null,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt ?? null,
        channelId: row.channelId ?? null,
        media: row.media ?? [],
        metrics: row.metrics ?? null,
        metricsAt: row.metricsAt ?? null,
        attempts: row.attempts,
    };
}

/** The moment a post belongs to on the calendar: when it is due, else when it went out, else when it was written. */
const CALENDAR_AT = sql`coalesce(${brandPosts.scheduledAt}, ${brandPosts.publishedAt}, ${brandPosts.createdAt})`;

export async function listBrandPosts(args: {
    companyId: bigint;
    from?: Date;
    to?: Date;
    statuses?: readonly BrandPostStatus[];
    limit?: number;
}): Promise<BrandPostRecord[]> {
    const db = getDb();
    const conditions = [eq(brandPosts.companyId, args.companyId)];
    // Raw sql params need a string; a Date would reach the driver as an object.
    if (args.from) conditions.push(sql`${CALENDAR_AT} >= ${args.from.toISOString()}::timestamptz`);
    if (args.to) conditions.push(sql`${CALENDAR_AT} < ${args.to.toISOString()}::timestamptz`);
    if (args.statuses?.length) conditions.push(inArray(brandPosts.status, [...args.statuses]));
    const rows = await db
        .select()
        .from(brandPosts)
        .where(and(...conditions))
        .orderBy(asc(CALENDAR_AT), asc(brandPosts.platform))
        .limit(Math.min(args.limit ?? 200, 1000));
    return rows.map(toRecord);
}

export async function getBrandPost(id: string, companyId: bigint): Promise<BrandPostRecord | null> {
    const db = getDb();
    const [row] = await db
        .select()
        .from(brandPosts)
        .where(and(eq(brandPosts.id, id), eq(brandPosts.companyId, companyId)))
        .limit(1);
    return row ? toRecord(row) : null;
}

/** Where one copy of a composed post goes: a network, and the workspace channel on it. */
export interface BrandPostTarget {
    platform: MarketingPlatform;
    /** Null posts on the deployment's own account for the network. */
    channelId: string | null;
}

export interface CreateBrandPostsArgs {
    companyId: bigint;
    userId: string;
    /** One copy per target. */
    targets?: readonly BrandPostTarget[];
    /** Legacy form: one copy per network on the deployment's account. */
    platforms?: readonly MarketingPlatform[];
    body: string;
    /** Images every copy carries (networks without media ignore them). */
    media?: readonly BrandPostMediaRef[];
    title?: string | null;
    /** Null or absent leaves the posts as drafts. */
    scheduledAt?: Date | null;
    source?: BrandPostSource | null;
    now?: Date;
}

function uniqueTargets(args: CreateBrandPostsArgs): BrandPostTarget[] {
    const all: BrandPostTarget[] = [
        ...(args.targets ?? []),
        ...(args.platforms ?? []).map(platform => ({ platform, channelId: null })),
    ];
    const seen = new Set<string>();
    return all.filter(t => {
        const key = `${t.platform}|${t.channelId ?? ""}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/**
 * One row per channel. Every body is checked against its network's limit
 * before anything is written, so a message to three channels is all-or-nothing.
 */
export async function createBrandPosts(args: CreateBrandPostsArgs): Promise<BrandPostRecord[]> {
    const targets = uniqueTargets(args);
    if (targets.length === 0)
        throw new BrandPostError("Pick at least one channel.", 400, "no_platform");
    for (const platform of new Set(targets.map(t => t.platform))) {
        const problem = bodyProblem(platform, args.body);
        if (problem) throw new BrandPostError(problem, 400, "body_invalid");
    }
    if ((args.media?.length ?? 0) > 4)
        throw new BrandPostError("A post carries at most four images.", 400, "media_invalid");
    const now = args.now ?? new Date();
    const scheduledAt = args.scheduledAt ?? null;
    if (scheduledAt && scheduledAt.getTime() < now.getTime() - 60_000)
        throw new BrandPostError("Pick a time that is still ahead.", 400, "schedule_past");
    const db = getDb();
    const rows = await db
        .insert(brandPosts)
        .values(
            targets.map(({ platform, channelId }) => ({
                id: randomUUID(),
                companyId: args.companyId,
                createdByUserId: args.userId,
                platform,
                channelId,
                body: args.body.trim(),
                title: platform === "reddit" ? cleanTitle(args.title) : null,
                status: (scheduledAt ? "scheduled" : "draft") as BrandPostStatus,
                scheduledAt,
                media: args.media && args.media.length > 0 ? [...args.media] : null,
                source: args.source ?? { kind: "compose" },
            }))
        )
        .returning();
    return rows.map(toRecord);
}

/** What the campaign generator's Publish button just did, so the calendar is complete. */
export async function recordPublishedBrandPost(args: {
    companyId: bigint;
    userId: string;
    platform: MarketingPlatform;
    body: string;
    title?: string | null;
    postId?: string | null;
    postUrl?: string | null;
    source?: BrandPostSource | null;
    now?: Date;
}): Promise<BrandPostRecord> {
    const db = getDb();
    const [row] = await db
        .insert(brandPosts)
        .values({
            id: randomUUID(),
            companyId: args.companyId,
            createdByUserId: args.userId,
            platform: args.platform,
            body: args.body,
            title: args.title ?? null,
            status: "published",
            publishedAt: args.now ?? new Date(),
            postId: args.postId ?? null,
            postUrl: args.postUrl ?? null,
            source: args.source ?? { kind: "campaign" },
        })
        .returning();
    return toRecord(row!);
}

const EDITABLE: readonly BrandPostStatus[] = ["draft", "scheduled", "failed", "cancelled"];

export interface UpdateBrandPostPatch {
    body?: string;
    title?: string | null;
    /** A date schedules, null makes it a draft again. */
    scheduledAt?: Date | null;
    /** Cancel keeps the row; scheduled/draft re-arm a cancelled or failed post. */
    status?: "cancelled" | "scheduled" | "draft";
}

/** Edits are allowed until a post is being published or is out. */
export async function updateBrandPost(
    id: string,
    companyId: bigint,
    patch: UpdateBrandPostPatch,
    now = new Date()
): Promise<BrandPostRecord> {
    const existing = await getBrandPost(id, companyId);
    if (!existing) throw new BrandPostError("Post not found", 404, "not_found");
    if (!EDITABLE.includes(existing.status))
        throw new BrandPostError(
            existing.status === "published"
                ? "This post is already out. Publish a new one instead."
                : "This post is being published right now.",
            409,
            "not_editable"
        );
    const body = patch.body ?? existing.body;
    const problem = bodyProblem(existing.platform, body);
    if (problem) throw new BrandPostError(problem, 400, "body_invalid");

    const scheduledAt = patch.scheduledAt !== undefined ? patch.scheduledAt : existing.scheduledAt;
    let status: BrandPostStatus = patch.status ?? existing.status;
    if (patch.status === undefined) {
        if (patch.scheduledAt === null) status = "draft";
        else if (patch.scheduledAt instanceof Date) status = "scheduled";
        else if (existing.status === "failed" && patch.body !== undefined) status = "draft";
    }
    if (status === "scheduled" && !scheduledAt)
        throw new BrandPostError("Pick a time to schedule this post.", 400, "schedule_missing");
    if (status === "scheduled" && scheduledAt && scheduledAt.getTime() < now.getTime() - 60_000)
        throw new BrandPostError("Pick a time that is still ahead.", 400, "schedule_past");

    const db = getDb();
    const [row] = await db
        .update(brandPosts)
        .set({
            body: body.trim(),
            title:
                existing.platform === "reddit"
                    ? patch.title !== undefined
                        ? cleanTitle(patch.title)
                        : existing.title
                    : null,
            scheduledAt: status === "draft" ? null : scheduledAt,
            status,
            error: status === "failed" ? existing.error : null,
            // A re-armed post starts its retry count over.
            ...(status === "failed" ? {} : { attempts: 0 }),
        })
        .where(and(eq(brandPosts.id, id), eq(brandPosts.companyId, companyId)))
        .returning();
    return toRecord(row!);
}

/** Only what never went out can be deleted; published posts stay as the record. */
export async function deleteBrandPost(id: string, companyId: bigint): Promise<void> {
    const existing = await getBrandPost(id, companyId);
    if (!existing) throw new BrandPostError("Post not found", 404, "not_found");
    if (existing.status === "published" || existing.status === "publishing")
        throw new BrandPostError("A published post stays on the calendar.", 409, "not_deletable");
    const db = getDb();
    await db
        .delete(brandPosts)
        .where(and(eq(brandPosts.id, id), eq(brandPosts.companyId, companyId)));
}

/**
 * How a claimed post reaches its network. The host passes one that knows
 * workspaces (channels, sealed credentials, stored images); without it a
 * post goes out on the deployment's env credentials, text only.
 */
export type PublishFn = (post: BrandPostRecord) => Promise<PublishResult>;

const publishWithDeploymentKeys: PublishFn = post =>
    publishToPlatform({
        platform: post.platform,
        message: post.body,
        title: post.title ?? undefined,
    });

/** Minutes to wait before retry n (1-based): 2, 8, 32. */
export function retryDelayMinutes(attempt: number): number {
    return 2 * 4 ** Math.max(0, attempt - 1);
}

export interface PublishDeps {
    publish?: PublishFn;
    now?: Date;
}

/**
 * Publish one post now. The claim is the whole concurrency story: whoever
 * flips the row to `publishing` posts; everyone else sees a 409.
 */
export async function publishBrandPost(
    id: string,
    companyId: bigint,
    deps: PublishDeps = {}
): Promise<BrandPostRecord> {
    const db = getDb();
    const [claimed] = await db
        .update(brandPosts)
        .set({ status: "publishing", error: null })
        .where(
            and(
                eq(brandPosts.id, id),
                eq(brandPosts.companyId, companyId),
                inArray(brandPosts.status, ["draft", "scheduled", "failed"])
            )
        )
        .returning();
    if (!claimed) {
        const existing = await getBrandPost(id, companyId);
        if (!existing) throw new BrandPostError("Post not found", 404, "not_found");
        throw new BrandPostError(
            existing.status === "published"
                ? "This post is already out."
                : existing.status === "publishing"
                  ? "This post is being published right now."
                  : "A cancelled post has to be rescheduled before it can go out.",
            409,
            "not_publishable"
        );
    }
    const post = toRecord(claimed);
    const publish = deps.publish ?? publishWithDeploymentKeys;
    let result: PublishResult;
    try {
        result = await publish(post);
    } catch (error) {
        result = {
            success: false,
            platform: post.platform,
            error: error instanceof Error ? error.message : String(error),
        };
    }
    const now = deps.now ?? new Date();
    const message = (result.error ?? "The network did not accept the post.").slice(0, 2000);
    const attempts = post.attempts + 1;
    // A rate limit or an outage is not the post's fault: put it back on the
    // calendar a little later, a few times, before calling it failed.
    const retry = !result.success && result.retryable === true && attempts < MAX_PUBLISH_ATTEMPTS;
    const [row] = await db
        .update(brandPosts)
        .set(
            result.success
                ? {
                      status: "published" as const,
                      publishedAt: now,
                      postId: result.postId ?? null,
                      postUrl: result.postUrl ?? null,
                      error: null,
                      attempts,
                  }
                : retry
                  ? {
                        status: "scheduled" as const,
                        scheduledAt: new Date(now.getTime() + retryDelayMinutes(attempts) * 60_000),
                        error: `Attempt ${attempts} of ${MAX_PUBLISH_ATTEMPTS} did not go through; trying again in ${retryDelayMinutes(attempts)} minutes. ${message}`.slice(
                            0,
                            2000
                        ),
                        attempts,
                    }
                  : {
                        status: "failed" as const,
                        error: message,
                        attempts,
                    }
        )
        .where(eq(brandPosts.id, id))
        .returning();
    return toRecord(row!);
}

export interface PublishDueResult {
    published: BrandPostRecord[];
    failed: BrandPostRecord[];
    /** Rows another scheduler claimed first. */
    skipped: number;
}

/**
 * Everything scheduled for a moment that has passed, oldest first. Safe to
 * run from the worker's cron and from the web app at the same time.
 */
export async function publishDueBrandPosts(
    args: { now?: Date; limit?: number; companyId?: bigint } & PublishDeps = {}
): Promise<PublishDueResult> {
    const now = args.now ?? new Date();
    const db = getDb();
    const conditions = [eq(brandPosts.status, "scheduled"), lte(brandPosts.scheduledAt, now)];
    if (args.companyId !== undefined) conditions.push(eq(brandPosts.companyId, args.companyId));
    const due = await db
        .select({ id: brandPosts.id, companyId: brandPosts.companyId })
        .from(brandPosts)
        .where(and(...conditions))
        .orderBy(asc(brandPosts.scheduledAt))
        .limit(args.limit ?? 25);
    const out: PublishDueResult = { published: [], failed: [], skipped: 0 };
    for (const row of due) {
        try {
            const post = await publishBrandPost(row.id, row.companyId, {
                publish: args.publish,
                now,
            });
            (post.status === "published" ? out.published : out.failed).push(post);
        } catch (error) {
            if (error instanceof BrandPostError && error.code === "not_publishable")
                out.skipped += 1;
            else throw error;
        }
    }
    return out;
}

/** Whether the web app should run the due-check after answering (dev has no worker). */
export async function hasDueBrandPosts(companyId: bigint, now = new Date()): Promise<boolean> {
    const db = getDb();
    const [row] = await db
        .select({ id: brandPosts.id })
        .from(brandPosts)
        .where(
            and(
                eq(brandPosts.companyId, companyId),
                eq(brandPosts.status, "scheduled"),
                lte(brandPosts.scheduledAt, now)
            )
        )
        .limit(1);
    return Boolean(row);
}
