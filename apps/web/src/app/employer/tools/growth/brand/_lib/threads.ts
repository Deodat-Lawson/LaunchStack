import type { BrandComment, BrandPlatform } from "../api";

/**
 * Comments as an inbox: grouped by the post they are on, each top-level
 * comment with its replies under it. Networks nest at most a level or two;
 * a reply to a reply is shown under the same top-level comment, in time
 * order, which is how LinkedIn itself lays a thread out.
 */

export interface CommentThread {
    root: BrandComment;
    /** Every reply under `root`, oldest first. */
    replies: BrandComment[];
}

export interface PostComments {
    postId: string;
    postExcerpt: string;
    postUrl: string | null;
    channelId: string;
    platform: BrandPlatform;
    threads: CommentThread[];
    /** Comments here still waiting on someone. */
    open: number;
    /** The newest comment's time, for ordering posts. */
    latestAt: string;
}

/** A comment someone still has to answer or mark done. The channel's own words never are. */
export function isOpen(comment: Pick<BrandComment, "isOwn" | "handledAt">): boolean {
    return !comment.isOwn && comment.handledAt === null;
}

export function openCount(comments: ReadonlyArray<Pick<BrandComment, "isOwn" | "handledAt">>) {
    return comments.filter(isOpen).length;
}

const time = (iso: string) => new Date(iso).getTime();

/** The top of the chain a comment belongs to, among the comments we have. */
function rootOf(comment: BrandComment, byId: Map<string, BrandComment>): BrandComment {
    let current = comment;
    const seen = new Set<string>([current.id]);
    while (current.parentId) {
        const parent = byId.get(current.parentId);
        // A parent we were not sent (filtered out, deleted) or a cycle: stop here.
        if (!parent || seen.has(parent.id)) break;
        seen.add(parent.id);
        current = parent;
    }
    return current;
}

/**
 * Group comments by post (posts with the newest activity first) and, inside
 * a post, into threads in the order they started.
 */
export function groupComments(comments: readonly BrandComment[]): PostComments[] {
    const byId = new Map(comments.map(c => [c.id, c]));
    const threads = new Map<string, CommentThread>();
    for (const comment of comments) {
        const root = rootOf(comment, byId);
        let thread = threads.get(root.id);
        if (!thread) {
            thread = { root, replies: [] };
            threads.set(root.id, thread);
        }
        if (comment.id !== root.id) thread.replies.push(comment);
    }

    const posts = new Map<string, PostComments>();
    for (const thread of threads.values()) {
        thread.replies.sort((a, b) => time(a.createdAt) - time(b.createdAt));
        const { root } = thread;
        let post = posts.get(root.postId);
        if (!post) {
            post = {
                postId: root.postId,
                postExcerpt: root.postExcerpt,
                postUrl: root.postUrl,
                channelId: root.channelId,
                platform: root.platform,
                threads: [],
                open: 0,
                latestAt: root.createdAt,
            };
            posts.set(root.postId, post);
        }
        post.threads.push(thread);
        for (const c of [root, ...thread.replies]) {
            if (isOpen(c)) post.open++;
            if (time(c.createdAt) > time(post.latestAt)) post.latestAt = c.createdAt;
        }
    }

    const out = [...posts.values()];
    for (const post of out)
        post.threads.sort((a, b) => time(a.root.createdAt) - time(b.root.createdAt));
    return out.sort((a, b) => time(b.latestAt) - time(a.latestAt));
}
