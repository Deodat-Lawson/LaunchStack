/**
 * Engagement: the comments read back on posts Brand published, and replies
 * sent as the channel. A comment is open until someone replies to it or
 * marks it done; replies the channel wrote are never open.
 */
import { randomUUID } from "node:crypto";

import { and, desc, eq, isNull } from "drizzle-orm";

import { brandPosts } from "@launchstack/pipelines/schema";
import type { MarketingPlatform } from "@launchstack/tools/platform-profiles";
import { createBlueskyPost } from "@launchstack/tools/social-publish/bluesky";
import { createLinkedInComment } from "@launchstack/tools/social-publish/linkedin";

import { db } from "~/server/db";
import { brandChannels, brandComments, type BrandCommentRow } from "~/server/db/schema/brand";

import {
    ChannelUnavailableError,
    getChannelRow,
    markConnectionReconnect,
    resolveChannelTarget,
} from "./channels";
import { linkedInApiOptions } from "./linkedin-options";

export interface BrandCommentView {
    id: string;
    channelId: string;
    platform: MarketingPlatform;
    postId: string;
    postExcerpt: string;
    postUrl: string | null;
    parentId: string | null;
    authorName: string;
    authorHandle: string | null;
    text: string;
    createdAt: Date;
    isOwn: boolean;
    handledAt: Date | null;
}

export class BrandCommentError extends Error {
    /** Read by the shared route error handler, which passes status and code through. */
    readonly code = "comment_failed";
    constructor(
        message: string,
        readonly status: number
    ) {
        super(message);
        this.name = "BrandCommentError";
    }
}

/** How long a reply may be: LinkedIn comments take 1,250 characters, Bluesky posts 300. */
export const REPLY_LIMITS: Record<string, number> = { linkedin: 1250, bluesky: 300 };

function excerpt(body: string): string {
    const flat = body.replace(/\s+/g, " ").trim();
    return flat.length > 140 ? `${flat.slice(0, 139)}…` : flat;
}

function fallbackAuthor(platform: string): string {
    return platform === "linkedin" ? "LinkedIn member" : "Bluesky user";
}

type Joined = {
    comment: BrandCommentRow;
    postBody: string;
    postUrl: string | null;
    channelName: string;
};

function toViews(rows: Joined[]): BrandCommentView[] {
    const idByExternal = new Map(
        rows.map(r => [`${r.comment.channelId}|${r.comment.externalId}`, r.comment.id])
    );
    return rows.map(({ comment, postBody, postUrl, channelName }) => ({
        id: comment.id,
        channelId: comment.channelId,
        platform: comment.platform as MarketingPlatform,
        postId: comment.postId,
        postExcerpt: excerpt(postBody),
        postUrl,
        parentId: comment.parentExternalId
            ? (idByExternal.get(`${comment.channelId}|${comment.parentExternalId}`) ?? null)
            : null,
        authorName: comment.isOwn
            ? channelName
            : (comment.authorName ?? comment.authorHandle ?? fallbackAuthor(comment.platform)),
        authorHandle: comment.authorHandle ?? null,
        text: comment.body,
        createdAt: comment.commentedAt,
        isOwn: comment.isOwn,
        handledAt: comment.handledAt ?? null,
    }));
}

async function selectJoined(companyId: bigint, onlyOpen: boolean, id?: string): Promise<Joined[]> {
    const conditions = [eq(brandComments.companyId, companyId)];
    if (onlyOpen) conditions.push(isNull(brandComments.handledAt));
    if (id) conditions.push(eq(brandComments.id, id));
    return db
        .select({
            comment: brandComments,
            postBody: brandPosts.body,
            postUrl: brandPosts.postUrl,
            channelName: brandChannels.name,
        })
        .from(brandComments)
        .innerJoin(brandPosts, eq(brandPosts.id, brandComments.postId))
        .innerJoin(brandChannels, eq(brandChannels.id, brandComments.channelId))
        .where(and(...conditions))
        .orderBy(desc(brandComments.commentedAt))
        .limit(500);
}

/**
 * Open comments, or everything. With "open", the channel's own replies are
 * left out by definition; parents of replies resolve within what is returned.
 */
export async function listBrandComments(
    companyId: bigint,
    status: "open" | "all"
): Promise<BrandCommentView[]> {
    return toViews(await selectJoined(companyId, status === "open"));
}

export async function setCommentHandled(
    companyId: bigint,
    id: string,
    handled: boolean,
    userId: string
): Promise<BrandCommentView | null> {
    const [row] = await db
        .update(brandComments)
        .set(
            handled
                ? { handledAt: new Date(), handledByUserId: userId }
                : { handledAt: null, handledByUserId: null }
        )
        .where(and(eq(brandComments.companyId, companyId), eq(brandComments.id, id)))
        .returning({ id: brandComments.id });
    if (!row) return null;
    const [joined] = await selectJoined(companyId, false, id);
    return joined ? toViews([joined])[0]! : null;
}

/** Reply as the channel; the answered comment is done. */
export async function replyToComment(args: {
    companyId: bigint;
    userId: string;
    commentId: string;
    text: string;
}): Promise<BrandCommentView> {
    const text = args.text.trim();
    const [joined] = await selectJoined(args.companyId, false, args.commentId);
    if (!joined) throw new BrandCommentError("Comment not found", 404);
    const { comment } = joined;
    if (!text) throw new BrandCommentError("Write a reply first.", 400);
    const limit = REPLY_LIMITS[comment.platform] ?? 1250;
    if (text.length > limit)
        throw new BrandCommentError(
            `Replies on ${comment.platform === "linkedin" ? "LinkedIn" : "Bluesky"} can be up to ${limit.toLocaleString()} characters.`,
            400
        );

    const channel = await getChannelRow(args.companyId, comment.channelId);
    if (!channel) throw new BrandCommentError("This channel was disconnected.", 409);
    const [post] = await db
        .select()
        .from(brandPosts)
        .where(eq(brandPosts.id, comment.postId))
        .limit(1);
    if (!post?.postId)
        throw new BrandCommentError("The post this comment is on is not on the network.", 409);

    let created: {
        externalId: string;
        parentExternalId: string | null;
        refs: BrandCommentRow["refs"];
    };
    try {
        const target = await resolveChannelTarget(channel);
        if (target.kind === "linkedin") {
            // LinkedIn threads one level deep: a reply to a reply hangs off the top comment.
            const parent = comment.parentExternalId ?? comment.externalId;
            const reply = await createLinkedInComment({
                ...linkedInApiOptions(target.accessToken),
                actorUrn: channel.externalId,
                postUrn: post.postId,
                parentCommentUrn: parent,
                text,
            });
            created = { externalId: reply.urn, parentExternalId: parent, refs: null };
        } else {
            const refs = comment.refs ?? {};
            if (!refs.cid || !refs.rootCid) {
                throw new BrandCommentError("Sync once more before replying to this comment.", 409);
            }
            const reply = await createBlueskyPost(
                {
                    identifier: target.identifier,
                    appPassword: target.appPassword,
                    service: target.service,
                },
                {
                    text,
                    reply: {
                        root: { uri: refs.rootUri ?? post.postId, cid: refs.rootCid },
                        parent: { uri: comment.externalId, cid: refs.cid },
                    },
                }
            );
            created = {
                externalId: reply.uri,
                parentExternalId: comment.externalId,
                refs: {
                    cid: reply.cid,
                    rootUri: refs.rootUri ?? post.postId,
                    rootCid: refs.rootCid,
                },
            };
        }
    } catch (error) {
        if (error instanceof BrandCommentError) throw error;
        if (error instanceof ChannelUnavailableError)
            throw new BrandCommentError(error.message, 409);
        const authFailed =
            error &&
            typeof error === "object" &&
            "authFailed" in error &&
            error.authFailed === true;
        if (authFailed) {
            await markConnectionReconnect(
                channel.connectionId,
                `The network refused the sign-in for ${channel.name}. Reconnect it under Accounts.`
            );
            throw new BrandCommentError(
                `The network refused the sign-in for ${channel.name}. Reconnect it under Accounts.`,
                409
            );
        }
        throw new BrandCommentError(
            `The reply did not go through: ${error instanceof Error ? error.message : String(error)}`,
            502
        );
    }

    const now = new Date();
    const id = randomUUID();
    await db
        .insert(brandComments)
        .values({
            id,
            companyId: args.companyId,
            channelId: channel.id,
            postId: post.id,
            platform: channel.platform,
            externalId: created.externalId,
            parentExternalId: created.parentExternalId,
            refs: created.refs,
            authorExternalId: channel.externalId,
            authorName: channel.name,
            authorHandle: channel.handle,
            body: text,
            isOwn: true,
            commentedAt: now,
            handledAt: now,
            handledByUserId: args.userId,
        })
        .onConflictDoNothing({ target: [brandComments.channelId, brandComments.externalId] });
    await db
        .update(brandComments)
        .set({ handledAt: now, handledByUserId: args.userId })
        .where(and(eq(brandComments.id, comment.id), isNull(brandComments.handledAt)));

    const [mine] = await selectJoined(args.companyId, false, id);
    if (!mine) throw new BrandCommentError("The reply was sent but could not be saved here.", 500);
    // The parent is the answered comment, or (LinkedIn, one level deep) its top comment.
    let parentId = comment.id;
    if (created.parentExternalId && created.parentExternalId !== comment.externalId) {
        const [top] = await db
            .select({ id: brandComments.id })
            .from(brandComments)
            .where(
                and(
                    eq(brandComments.channelId, channel.id),
                    eq(brandComments.externalId, created.parentExternalId)
                )
            )
            .limit(1);
        if (top) parentId = top.id;
    }
    return { ...toViews([mine])[0]!, parentId };
}
