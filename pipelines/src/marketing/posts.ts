/**
 * Brand posts: what the Brand area composes, schedules and publishes. The
 * adapters in @launchstack/tools/social-publish do the posting; this module
 * owns the rows and the one rule that keeps two schedulers from posting the
 * same thing twice: a post is claimed with a single conditional update
 * (draft | scheduled | failed → publishing) before any network is called.
 */
import { randomUUID } from "node:crypto";

import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { getDb } from "@launchstack/store/client";
import {
    MarketingPlatformEnum,
    PLATFORM_PROFILES,
    type MarketingPlatform,
} from "@launchstack/tools/platform-profiles";
import { publishContent, type PublishResult } from "@launchstack/tools/social-publish";

import {
    BRAND_POST_STATUSES,
    brandPosts,
    type BrandPostRow,
    type BrandPostSource,
    type BrandPostStatus,
} from "./schema";

export { BRAND_POST_STATUSES, MarketingPlatformEnum };
export type { BrandPostSource, BrandPostStatus };

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
    /** Publish attempts so far. */
    attempts: number;
    /** When the scheduler may retry after a transient failure; null means at scheduledAt. */
    nextAttemptAt: Date | null;
    lastAttemptAt: Date | null;
}

/**
 * How many times a scheduled post is tried before it is left as failed, and
 * how long to wait between tries. Transient errors (429, 5xx, a network
 * timeout) are retried; anything else fails at once.
 */
export const MAX_PUBLISH_ATTEMPTS = 5;
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];

export function retryDelayMs(attemptsSoFar: number): number {
    return RETRY_DELAYS_MS[Math.min(attemptsSoFar - 1, RETRY_DELAYS_MS.length - 1)] ?? 60_000;
}

export type PublishOutcome =
    | { kind: "published" }
    | { kind: "retry"; delayMs: number }
    | { kind: "failed" };

/** Decide what a failed publish result means for the row: retry later, or give up. */
export function classifyPublishFailure(
    result: Pick<PublishResult, "success" | "retryable" | "authFailed">,
    attemptsAfterThisOne: number
): PublishOutcome {
    if (result.success) return { kind: "published" };
    if (result.authFailed) return { kind: "failed" };
    if (result.retryable && attemptsAfterThisOne < MAX_PUBLISH_ATTEMPTS)
        return { kind: "retry", delayMs: retryDelayMs(attemptsAfterThisOne) };
    return { kind: "failed" };
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
        attempts: row.attempts ?? 0,
        nextAttemptAt: row.nextAttemptAt ?? null,
        lastAttemptAt: row.lastAttemptAt ?? null,
    };
}

/** The moment the scheduler should act on a scheduled post: the retry time if one is set, else its slot. */
const DUE_AT = sql`coalesce(${brandPosts.nextAttemptAt}, ${brandPosts.scheduledAt})`;

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

export interface CreateBrandPostsArgs {
    companyId: bigint;
    userId: string;
    platforms: readonly MarketingPlatform[];
    body: string;
    title?: string | null;
    /** Null or absent leaves the posts as drafts. */
    scheduledAt?: Date | null;
    source?: BrandPostSource | null;
    now?: Date;
}

/**
 * One row per network. Every body is checked against its network's limit
 * before anything is written, so a message to three networks is all-or-nothing.
 */
export async function createBrandPosts(args: CreateBrandPostsArgs): Promise<BrandPostRecord[]> {
    const platforms = [...new Set(args.platforms)];
    if (platforms.length === 0)
        throw new BrandPostError("Pick at least one network.", 400, "no_platform");
    for (const platform of platforms) {
        const problem = bodyProblem(platform, args.body);
        if (problem) throw new BrandPostError(problem, 400, "body_invalid");
    }
    const now = args.now ?? new Date();
    const scheduledAt = args.scheduledAt ?? null;
    if (scheduledAt && scheduledAt.getTime() < now.getTime() - 60_000)
        throw new BrandPostError("Pick a time that is still ahead.", 400, "schedule_past");
    const db = getDb();
    const rows = await db
        .insert(brandPosts)
        .values(
            platforms.map(platform => ({
                id: randomUUID(),
                companyId: args.companyId,
                createdByUserId: args.userId,
                platform,
                body: args.body.trim(),
                title: platform === "reddit" ? cleanTitle(args.title) : null,
                status: (scheduledAt ? "scheduled" : "draft") as BrandPostStatus,
                scheduledAt,
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
            // Any edit or re-arm starts the attempt count over.
            attempts: 0,
            nextAttemptAt: null,
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
 * The host supplies the network call so it can resolve the workspace's own
 * credentials; the default posts with the deployment's environment.
 */
export type PublishFn = (post: BrandPostRecord) => Promise<PublishResult>;

export interface PublishDeps {
    publish?: PublishFn;
    now?: Date;
}

const defaultPublish: PublishFn = post =>
    publishContent(post.platform, post.body, post.title ?? undefined);

/**
 * Publish one post now. The claim is the whole concurrency story: whoever
 * flips the row to `publishing` posts; everyone else sees a 409. A transient
 * failure puts the post back to `scheduled` with a retry time; a permanent
 * one, or the last allowed attempt, marks it `failed`.
 */
export async function publishBrandPost(
    id: string,
    companyId: bigint,
    deps: PublishDeps = {}
): Promise<BrandPostRecord> {
    const db = getDb();
    const now = deps.now ?? new Date();
    const [claimed] = await db
        .update(brandPosts)
        .set({
            status: "publishing",
            error: null,
            attempts: sql`${brandPosts.attempts} + 1`,
            lastAttemptAt: now,
        })
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
    const publish = deps.publish ?? defaultPublish;
    let result: PublishResult;
    try {
        result = await publish(post);
    } catch (error) {
        // A thrown error is a network or code failure, not the network
        // refusing the post: worth another try.
        result = {
            success: false,
            platform: post.platform,
            error: error instanceof Error ? error.message : String(error),
            retryable: true,
        };
    }
    const outcome = classifyPublishFailure(result, post.attempts);
    const errorText = (result.error ?? "The network did not accept the post.").slice(0, 2000);
    const [row] = await db
        .update(brandPosts)
        .set(
            outcome.kind === "published"
                ? {
                      status: "published" as const,
                      publishedAt: now,
                      postId: result.postId ?? null,
                      postUrl: result.postUrl ?? null,
                      error: null,
                      nextAttemptAt: null,
                  }
                : outcome.kind === "retry"
                  ? {
                        status: "scheduled" as const,
                        error: `${errorText} Retrying in ${describeDelay(outcome.delayMs)}.`,
                        nextAttemptAt: new Date(now.getTime() + outcome.delayMs),
                    }
                  : {
                        status: "failed" as const,
                        error: errorText,
                        nextAttemptAt: null,
                    }
        )
        .where(eq(brandPosts.id, id))
        .returning();
    return toRecord(row!);
}

function describeDelay(ms: number): string {
    const minutes = Math.round(ms / 60_000);
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.round(minutes / 60);
    return `${hours} h`;
}

export interface PublishDueResult {
    published: BrandPostRecord[];
    failed: BrandPostRecord[];
    /** Posts that hit a transient error and will be tried again. */
    retrying: BrandPostRecord[];
    /** Rows another scheduler claimed first. */
    skipped: number;
}

/**
 * Everything scheduled for a moment that has passed, oldest first, including
 * posts whose retry time has come. Safe to run from two schedulers at once:
 * the claim inside publishBrandPost decides who posts.
 */
export async function publishDueBrandPosts(
    args: { now?: Date; limit?: number; companyId?: bigint } & PublishDeps = {}
): Promise<PublishDueResult> {
    const now = args.now ?? new Date();
    const db = getDb();
    const conditions = [
        eq(brandPosts.status, "scheduled"),
        sql`${DUE_AT} <= ${now.toISOString()}::timestamptz`,
    ];
    if (args.companyId !== undefined) conditions.push(eq(brandPosts.companyId, args.companyId));
    const due = await db
        .select({ id: brandPosts.id, companyId: brandPosts.companyId })
        .from(brandPosts)
        .where(and(...conditions))
        .orderBy(asc(DUE_AT))
        .limit(args.limit ?? 25);
    const out: PublishDueResult = { published: [], failed: [], retrying: [], skipped: 0 };
    for (const row of due) {
        try {
            const post = await publishBrandPost(row.id, row.companyId, {
                publish: args.publish,
                now,
            });
            if (post.status === "published") out.published.push(post);
            else if (post.status === "scheduled") out.retrying.push(post);
            else out.failed.push(post);
        } catch (error) {
            if (error instanceof BrandPostError && error.code === "not_publishable")
                out.skipped += 1;
            else throw error;
        }
    }
    return out;
}
