/**
 * Applying one agent action to the world, with OASIS's platform rules:
 * one like (or dislike) per post, no rating your own post, one repost per
 * root post, reposts/quotes/comments resolve to the root, no following
 * yourself or someone you already follow.
 */

import { clip } from "./text";
import type { Action, World } from "./types";
import { addPost, findAgent, findPost, MAX_COMMENT_CHARS, rootOf } from "./world";

export type ApplyResult = { ok: true; createdId?: string } | { ok: false; reason: string };

export function applyAction(
    world: World,
    agentId: string,
    action: Action,
    round: number
): ApplyResult {
    switch (action.type) {
        case "do_nothing":
            return { ok: true };
        case "create_post": {
            const text = action.text.trim();
            if (!text) return { ok: false, reason: "empty post" };
            const post = addPost(world, { authorId: agentId, round, kind: "post", text });
            return { ok: true, createdId: post.id };
        }
        case "comment": {
            const target = findPost(world, action.postId);
            if (!target) return { ok: false, reason: "unknown post" };
            const text = action.text.trim();
            if (!text) return { ok: false, reason: "empty comment" };
            const root = rootOf(world, target);
            const id = `c${world.nextComment++}`;
            world.comments.push({
                id,
                postId: root.id,
                authorId: agentId,
                round,
                text: clip(text, MAX_COMMENT_CHARS),
            });
            root.comments += 1;
            return { ok: true, createdId: id };
        }
        case "like":
        case "dislike": {
            const target = findPost(world, action.postId);
            if (!target) return { ok: false, reason: "unknown post" };
            const root = rootOf(world, target);
            if (root.authorId === agentId) return { ok: false, reason: "own post" };
            const exists = world.reactions.some(
                r => r.agentId === agentId && r.postId === root.id && r.kind === action.type
            );
            if (exists) return { ok: false, reason: `already ${action.type}d` };
            world.reactions.push({ agentId, postId: root.id, kind: action.type, round });
            if (action.type === "like") root.likes += 1;
            else root.dislikes += 1;
            return { ok: true };
        }
        case "repost": {
            const target = findPost(world, action.postId);
            if (!target) return { ok: false, reason: "unknown post" };
            const root = rootOf(world, target);
            if (root.authorId === agentId) return { ok: false, reason: "own post" };
            const already = world.posts.some(
                p => p.kind === "repost" && p.authorId === agentId && p.rootId === root.id
            );
            if (already) return { ok: false, reason: "already reposted" };
            const post = addPost(world, {
                authorId: agentId,
                round,
                kind: "repost",
                text: root.text,
                rootId: root.id,
            });
            root.shares += 1;
            return { ok: true, createdId: post.id };
        }
        case "quote": {
            const target = findPost(world, action.postId);
            if (!target) return { ok: false, reason: "unknown post" };
            const text = action.text.trim();
            if (!text) return { ok: false, reason: "empty quote" };
            const root = rootOf(world, target);
            const post = addPost(world, {
                authorId: agentId,
                round,
                kind: "quote",
                text,
                rootId: root.id,
            });
            root.shares += 1;
            return { ok: true, createdId: post.id };
        }
        case "follow": {
            if (action.agentId === agentId) return { ok: false, reason: "self" };
            if (!findAgent(world, action.agentId)) return { ok: false, reason: "unknown account" };
            if (world.follows.some(([a, b]) => a === agentId && b === action.agentId)) {
                return { ok: false, reason: "already following" };
            }
            world.follows.push([agentId, action.agentId]);
            return { ok: true };
        }
    }
}

/** A one-line, second-person description of an action, for the agent's memory. */
export function describeAction(world: World, action: Action): string {
    const quote = (id: string) => {
        const post = findPost(world, id);
        if (!post) return "a post";
        const root = rootOf(world, post);
        const who =
            findAgent(world, root.authorId)?.persona.handle ??
            world.accounts.find(a => a.id === root.authorId)?.handle ??
            "someone";
        return `${who}'s post "${clip(root.text, 80)}"`;
    };
    switch (action.type) {
        case "do_nothing":
            return "You scrolled past without acting.";
        case "create_post":
            return `You posted: "${clip(action.text, 140)}"`;
        case "comment":
            return `You commented on ${quote(action.postId)}: "${clip(action.text, 100)}"`;
        case "like":
            return `You liked ${quote(action.postId)}.`;
        case "dislike":
            return `You disliked ${quote(action.postId)}.`;
        case "repost":
            return `You reposted ${quote(action.postId)}.`;
        case "quote":
            return `You quoted ${quote(action.postId)}: "${clip(action.text, 100)}"`;
        case "follow":
            return `You followed ${findAgent(world, action.agentId)?.persona.handle ?? "someone"}.`;
    }
}
