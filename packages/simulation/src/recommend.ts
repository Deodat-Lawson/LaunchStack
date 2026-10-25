/**
 * Feeds — the OASIS recommendation table and refresh, ported.
 *
 * OASIS rebuilds a recommendation table between time steps and, when an agent
 * refreshes, shows posts from that table plus the most-liked posts of accounts
 * it follows. The table scores each post for each user by interest similarity
 * (profile vs post), multiplied by a time decay, and Reddit's hot score
 * ranks by votes and age. A share of the picks is swapped for random posts.
 *
 * Differences, on purpose:
 * - Interest is lexical TF-IDF cosine by default (no embedding model here);
 *   hosts may inject a similarity function.
 * - The decay uses rounds × `minutesPerRound` and is floored so long runs
 *   keep a ranking (OASIS's formula goes negative after ~271 minutes).
 * - Posts an agent has already been shown are down-weighted, so feeds move on.
 * - Narrator events and the opening post are pinned to the top for two rounds.
 */

import type { Rng } from "./rng";
import { pick } from "./rng";
import { clip, cosine, idf, tfidf, tokenize } from "./text";
import type { FeedItem, Post, World } from "./types";
import { author, followeesOf, rootOf, visibleFrom } from "./world";

export type Similarity = (profile: string, postText: string) => number;

export interface FeedOptions {
    similarity?: Similarity;
}

/** Reddit's hot score, as OASIS implements it, with seconds taken from rounds. */
export function hotScore(
    likes: number,
    dislikes: number,
    visibleRound: number,
    minutesPerRound: number
): number {
    const s = likes - dislikes;
    const order = Math.log10(Math.max(Math.abs(s), 1));
    const sign = s > 0 ? 1 : s < 0 ? -1 : 0;
    const seconds = visibleRound * minutesPerRound * 60;
    return sign * order + seconds / 45000;
}

/** OASIS's TwHIN time decay, ln((271.8 − age) / 100), floored at 0.05. */
export function timeDecay(ageRounds: number, minutesPerRound: number): number {
    const arg = (271.8 - ageRounds * minutesPerRound) / 100;
    if (arg <= 0) return 0.05;
    return Math.max(0.05, Math.log(arg));
}

export function profileText(world: World, agentId: string): string {
    const agent = world.agents.find(a => a.persona.id === agentId);
    if (!agent) return "";
    const p = agent.persona;
    const latest = [...world.posts]
        .reverse()
        .find(post => post.authorId === agentId && post.kind !== "repost");
    return [
        p.role,
        p.bio,
        p.interests.join(", "),
        latest ? `Recent post: ${latest.text}` : "",
    ].join(" ");
}

function postText(world: World, post: Post): string {
    if (post.kind === "repost") return rootOf(world, post).text;
    if (post.kind === "quote") return `${post.text} ${rootOf(world, post).text}`;
    return post.text;
}

export function toFeedItem(world: World, post: Post, reason: FeedItem["reason"]): FeedItem {
    const who = author(world, post.authorId);
    const root = post.rootId ? rootOf(world, post) : undefined;
    const target = root ?? post;
    const recentComments = world.comments
        .filter(c => c.postId === target.id)
        .slice(-2)
        .map(c => ({ handle: author(world, c.authorId).handle, text: clip(c.text, 160) }));
    const item: FeedItem = {
        postId: post.id,
        authorId: post.authorId,
        authorName: who.name,
        authorHandle: who.handle,
        kind: post.kind,
        text: clip(post.text, 400),
        likes: target.likes,
        shares: target.shares,
        comments: target.comments,
        recentComments,
        reason,
    };
    if (root && root.id !== post.id) {
        item.root = { handle: author(world, root.authorId).handle, text: clip(root.text, 300) };
    }
    return item;
}

/**
 * Build the feed each active agent sees in the coming round (`world.round + 1`).
 * Feeds are computed from the world as it stands, so agents acting in the same
 * round never see each other's new posts until the next round.
 */
export function buildFeeds(
    world: World,
    activeIds: string[],
    rng: Rng,
    options: FeedOptions = {}
): Map<string, FeedItem[]> {
    const current = world.round + 1;
    const cfg = world.config;
    const visible = world.posts.filter(p => visibleFrom(p) <= current);

    let similarity = options.similarity;
    if (!similarity) {
        const docs = [
            ...visible.map(p => tokenize(postText(world, p))),
            ...world.agents.map(a => tokenize(profileText(world, a.persona.id))),
        ];
        const weights = idf(docs);
        const cache = new Map<string, ReturnType<typeof tfidf>>();
        const vec = (text: string) => {
            let v = cache.get(text);
            if (!v) {
                v = tfidf(tokenize(text), weights);
                cache.set(text, v);
            }
            return v;
        };
        similarity = (profile, text) => cosine(vec(profile), vec(text));
    }

    const feeds = new Map<string, FeedItem[]>();
    for (const agentId of activeIds) {
        const seen = new Set(world.seen[agentId] ?? []);
        const following = new Set(followeesOf(world, agentId));
        const candidates = visible.filter(p => p.authorId !== agentId);
        const chosen = new Map<string, FeedItem["reason"]>();

        const pinned = candidates
            .filter(
                p =>
                    (p.kind === "seed" || p.kind === "event") &&
                    current - visibleFrom(p) <= 1 &&
                    !seen.has(p.id)
            )
            .slice(-2);
        for (const p of pinned) chosen.set(p.id, "pinned");

        const fromFollowing = candidates
            .filter(p => following.has(p.authorId) && !chosen.has(p.id))
            .sort((a, b) => b.likes - a.likes || visibleFrom(b) - visibleFrom(a))
            .slice(0, cfg.followingCount);
        for (const p of fromFollowing) chosen.set(p.id, "following");

        const profile = profileText(world, agentId);
        const scored = candidates
            .filter(p => !chosen.has(p.id))
            .map(p => {
                const root = rootOf(world, p);
                const age = current - visibleFrom(p);
                const interest = Math.max(0, similarity(profile, postText(world, p)));
                const hot = hotScore(
                    root.likes,
                    root.dislikes,
                    visibleFrom(p),
                    cfg.minutesPerRound
                );
                const hotTerm = Math.max(-1, Math.min(1, hot / 2));
                let score =
                    (0.75 * interest + 0.25 * hotTerm) * timeDecay(age, cfg.minutesPerRound);
                if (seen.has(p.id)) score *= 0.35;
                return { post: p, score };
            })
            .sort((a, b) => b.score - a.score || (a.post.id < b.post.id ? -1 : 1));
        const recommended = scored.slice(0, cfg.recommendCount).map(s => s.post);

        const rest = scored.slice(cfg.recommendCount).map(s => s.post);
        const swapped = recommended.map(p => {
            if (rest.length === 0 || rng() >= cfg.swapRate)
                return { post: p, reason: "recommended" as const };
            const unseen = rest.filter(r => !seen.has(r.id));
            const replacement = pick(unseen.length > 0 ? unseen : rest, rng)!;
            rest.splice(rest.indexOf(replacement), 1);
            return { post: replacement, reason: "random" as const };
        });
        for (const s of swapped) if (!chosen.has(s.post.id)) chosen.set(s.post.id, s.reason);

        const byId = new Map(candidates.map(p => [p.id, p]));
        feeds.set(
            agentId,
            [...chosen.entries()].map(([id, reason]) => toFeedItem(world, byId.get(id)!, reason))
        );
    }
    return feeds;
}
