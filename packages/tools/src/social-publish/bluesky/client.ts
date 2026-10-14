/** Bluesky calls: sign-in check, profiles, posting with images, counts and replies. */
import { nonBlank } from "../text";
import type { PublishMedia } from "../types";
import {
    blueskyContext,
    createSession,
    readJson,
    withSession,
    xrpc,
    xrpcErrorCode,
    type BlueskyContext,
    type BlueskySession,
} from "./http";
import {
    BLUESKY_MAX_GRAPHEMES,
    BLUESKY_MAX_TEXT_BYTES,
    detectFacets,
    graphemeLength,
    imageDimensions,
    utf8Length,
} from "./richtext";
import {
    BlueskyApiError,
    type BlueskyCredentials,
    type BlueskyOptions,
    type BlueskyPostRef,
    type BlueskyPostStats,
    type BlueskyProfile,
    type BlueskyReply,
} from "./types";

interface ProfileView {
    did?: string;
    handle?: string;
    displayName?: string;
    avatar?: string;
    followersCount?: number;
}

function toProfile(view: ProfileView | null, fallback: { did: string; handle: string }) {
    const profile: BlueskyProfile = {
        did: view?.did ?? fallback.did,
        handle: view?.handle ?? fallback.handle,
        displayName: nonBlank(view?.displayName) ?? null,
        avatarUrl: nonBlank(view?.avatar) ?? null,
        followers: typeof view?.followersCount === "number" ? view.followersCount : null,
    };
    return profile;
}

/**
 * Sign in once and read the profile: proves the app password and names the
 * account. Always a fresh sign-in (never the cached session), which is then
 * cached for the posts that follow. A refused handle or password throws an
 * authFailed BlueskyApiError ("Bluesky refused that handle and app password").
 */
export async function verifyBlueskyCredentials(
    creds: BlueskyCredentials,
    opts?: BlueskyOptions
): Promise<BlueskyProfile> {
    const ctx = blueskyContext(creds, opts);
    const session = await createSession(ctx, creds);
    const res = await xrpc(ctx, {
        base: ctx.service,
        nsid: "app.bsky.actor.getProfile",
        query: { actor: session.did },
        accessJwt: session.accessJwt,
        what: "read the account profile",
    });
    return toProfile(await readJson<ProfileView>(res), session);
}

/**
 * A public profile from the AppView, no sign-in: lets the host refresh
 * names, avatars and follower counts without touching the app password.
 */
export async function getBlueskyProfile(
    actor: string,
    opts?: BlueskyOptions
): Promise<BlueskyProfile> {
    const ctx = blueskyContext(null, opts);
    const handle = actor.trim().replace(/^@/, "");
    const res = await xrpc(ctx, {
        base: ctx.appView,
        nsid: "app.bsky.actor.getProfile",
        query: { actor: handle },
        what: "read the profile",
    });
    const view = await readJson<ProfileView>(res);
    return toProfile(view, { did: handle.startsWith("did:") ? handle : "", handle });
}

/** The `app.bsky.embed.images` limits: four images, each at most 1,000,000 bytes. */
export const BLUESKY_MAX_IMAGES = 4;
export const BLUESKY_MAX_IMAGE_BYTES = 1_000_000;
const BLUESKY_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

function validatePost(text: string, media: PublishMedia[]): void {
    const graphemes = graphemeLength(text);
    if (graphemes > BLUESKY_MAX_GRAPHEMES) {
        throw new BlueskyApiError(
            `Bluesky posts are limited to ${BLUESKY_MAX_GRAPHEMES} characters; this one has ${graphemes}.`,
            400,
            false,
            false
        );
    }
    if (utf8Length(text) > BLUESKY_MAX_TEXT_BYTES) {
        throw new BlueskyApiError(
            `Bluesky posts are limited to ${BLUESKY_MAX_TEXT_BYTES} bytes of text; this one is longer.`,
            400,
            false,
            false
        );
    }
    if (media.length > BLUESKY_MAX_IMAGES) {
        throw new BlueskyApiError(
            `Bluesky takes at most ${BLUESKY_MAX_IMAGES} images in one post (this one has ${media.length}).`,
            400,
            false,
            false
        );
    }
    for (const image of media) {
        const label = image.filename ?? "an image";
        const mime = normalizeMime(image.mimeType);
        if (!BLUESKY_IMAGE_TYPES.has(mime)) {
            throw new BlueskyApiError(
                `Bluesky takes JPG, PNG, WebP or GIF images (${label} is ${image.mimeType}).`,
                415,
                false,
                false
            );
        }
        if (image.data.byteLength > BLUESKY_MAX_IMAGE_BYTES) {
            const mb = (image.data.byteLength / 1_000_000).toFixed(1);
            throw new BlueskyApiError(
                `Bluesky takes images up to 1 MB; ${label} is ${mb} MB.`,
                413,
                false,
                false
            );
        }
    }
}

function normalizeMime(mime: string): string {
    const lower = mime.trim().toLowerCase();
    return lower === "image/jpg" || lower === "image/pjpeg" ? "image/jpeg" : lower;
}

async function uploadBlob(
    ctx: BlueskyContext,
    session: BlueskySession,
    image: PublishMedia
): Promise<unknown> {
    const res = await xrpc(ctx, {
        base: ctx.service,
        nsid: "com.atproto.repo.uploadBlob",
        method: "POST",
        bytes: image.data,
        contentType: normalizeMime(image.mimeType),
        accessJwt: session.accessJwt,
        what: "upload the image",
    });
    const data = await readJson<{ blob?: unknown }>(res);
    if (!data?.blob) {
        throw new BlueskyApiError(
            "Bluesky did not return the uploaded image.",
            res.status,
            false,
            true
        );
    }
    return data.blob;
}

/**
 * Post as the account. Text over 300 graphemes (or 3000 bytes) is refused
 * here, never truncated. Images (up to 4, each ≤ 1 MB) are uploaded as blobs
 * and embedded with alt text and aspect ratio; links and hashtags in the
 * text get facets so they are clickable. With `reply`, the post answers
 * `reply.parent` in the thread rooted at `reply.root`.
 */
export async function createBlueskyPost(
    creds: BlueskyCredentials,
    post: {
        text: string;
        media?: PublishMedia[];
        reply?: { root: BlueskyPostRef; parent: BlueskyPostRef };
        /** BCP-47 language tags for the post (`["en"]`). */
        langs?: string[];
    },
    opts?: BlueskyOptions
): Promise<BlueskyPostRef & { url: string }> {
    const media = post.media ?? [];
    validatePost(post.text, media);
    const ctx = blueskyContext(creds, opts);

    return withSession(ctx, creds, async session => {
        const images = [];
        for (const image of media) {
            const blob = await uploadBlob(ctx, session, image);
            const size = imageDimensions(image.data);
            images.push({
                image: blob,
                alt: image.alt?.trim() ?? "",
                ...(size ? { aspectRatio: size } : {}),
            });
        }

        const facets = detectFacets(post.text);
        const record: Record<string, unknown> = {
            $type: "app.bsky.feed.post",
            text: post.text,
            createdAt: new Date().toISOString(),
        };
        if (post.langs?.length) record.langs = post.langs;
        if (facets.length) record.facets = facets;
        if (images.length) record.embed = { $type: "app.bsky.embed.images", images };
        if (post.reply) {
            record.reply = {
                root: { uri: post.reply.root.uri, cid: post.reply.root.cid },
                parent: { uri: post.reply.parent.uri, cid: post.reply.parent.cid },
            };
        }

        let res: Response;
        try {
            res = await xrpc(ctx, {
                base: ctx.service,
                nsid: "com.atproto.repo.createRecord",
                method: "POST",
                json: { repo: session.did, collection: "app.bsky.feed.post", record },
                accessJwt: session.accessJwt,
                what: "publish the post",
            });
        } catch (error) {
            // A 5xx or a dropped connection after the request went out may
            // still have created the record; only a 429 is a clean refusal.
            if (error instanceof BlueskyApiError && error.retryable && error.status !== 429) {
                throw new BlueskyApiError(
                    `Bluesky did not confirm the post, so it may have gone out. Check the account before publishing again. (${error.message})`,
                    error.status,
                    false,
                    false,
                    error.body
                );
            }
            throw error;
        }
        const created = await readJson<{ uri?: string; cid?: string }>(res);
        if (!created?.uri) {
            // The record may exist; retrying could post twice.
            throw new BlueskyApiError(
                "Bluesky accepted the post but did not return its id.",
                res.status,
                false,
                false
            );
        }
        return {
            uri: created.uri,
            cid: created.cid ?? "",
            url: blueskyPostUrl(session.handle, created.uri),
        };
    });
}

const POSTS_PER_CALL = 25;

interface PostView {
    uri?: string;
    cid?: string;
    author?: { did?: string; handle?: string; displayName?: string };
    record?: {
        text?: string;
        createdAt?: string;
        reply?: { root?: BlueskyPostRef; parent?: BlueskyPostRef };
    };
    indexedAt?: string;
    likeCount?: number;
    repostCount?: number;
    replyCount?: number;
    quoteCount?: number;
}

/** Counts for posts by AT URI (public AppView, no auth); 25 per call, any number in. */
export async function getBlueskyPostStats(
    uris: string[],
    opts?: BlueskyOptions
): Promise<Map<string, BlueskyPostStats>> {
    const ctx = blueskyContext(null, opts);
    const stats = new Map<string, BlueskyPostStats>();
    const unique = [...new Set(uris.filter(u => u.startsWith("at://")))];

    for (let i = 0; i < unique.length; i += POSTS_PER_CALL) {
        const res = await xrpc(ctx, {
            base: ctx.appView,
            nsid: "app.bsky.feed.getPosts",
            query: { uris: unique.slice(i, i + POSTS_PER_CALL) },
            what: "read post counts",
        });
        const data = await readJson<{ posts?: PostView[] }>(res);
        for (const post of data?.posts ?? []) {
            if (!post.uri) continue;
            stats.set(post.uri, {
                uri: post.uri,
                likes: post.likeCount ?? 0,
                reposts: post.repostCount ?? 0,
                replies: post.replyCount ?? 0,
                quotes: post.quoteCount ?? 0,
            });
        }
    }
    return stats;
}

interface ThreadNode {
    post?: PostView;
    replies?: ThreadNode[];
}

/**
 * Direct and nested replies to a post (public AppView, six levels deep),
 * newest first. Deleted or blocked replies are skipped; a post that no
 * longer exists has no replies.
 */
export async function listBlueskyReplies(
    uri: string,
    opts?: BlueskyOptions
): Promise<BlueskyReply[]> {
    const ctx = blueskyContext(null, opts);
    let res: Response;
    try {
        res = await xrpc(ctx, {
            base: ctx.appView,
            nsid: "app.bsky.feed.getPostThread",
            query: { uri, depth: 6 },
            what: "read the post's replies",
        });
    } catch (err) {
        if (err instanceof BlueskyApiError && xrpcErrorCode(err.body) === "NotFound") return [];
        throw err;
    }
    const data = await readJson<{ thread?: ThreadNode }>(res);
    const root = data?.thread?.post;
    const rootRef: BlueskyPostRef = { uri: root?.uri ?? uri, cid: root?.cid ?? "" };

    const replies: BlueskyReply[] = [];
    const walk = (nodes: ThreadNode[] | undefined, parentRef: BlueskyPostRef) => {
        for (const node of nodes ?? []) {
            const post = node.post;
            if (!post?.uri || !post.cid || !post.author?.did) continue;
            const reply = post.record?.reply;
            replies.push({
                uri: post.uri,
                cid: post.cid,
                parent: reply?.parent ?? parentRef,
                root: reply?.root ?? rootRef,
                authorDid: post.author.did,
                authorHandle: post.author.handle ?? post.author.did,
                authorName: nonBlank(post.author.displayName) ?? null,
                text: post.record?.text ?? "",
                createdAt: new Date(post.record?.createdAt ?? post.indexedAt ?? 0),
            });
            walk(node.replies, { uri: post.uri, cid: post.cid });
        }
    };
    walk(data?.thread?.replies, rootRef);

    return replies.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/** Public URL for a post: https://bsky.app/profile/<handle>/post/<rkey>. */
export function blueskyPostUrl(handleOrDid: string, uri: string): string {
    const rkey = uri.split("/").pop() ?? "";
    return `https://bsky.app/profile/${handleOrDid}/post/${rkey}`;
}
