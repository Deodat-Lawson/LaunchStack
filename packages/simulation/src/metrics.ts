/**
 * Numbers read off a world: per-round summaries, engagement on one post (the
 * draft under test), the most-engaged posts, factions, and stance shifts.
 */

import type { Post, RoundSummary, Stance, Usage, World } from "./types";
import { rootOf } from "./world";

export function stanceCounts(world: World): [number, number, number, number, number] {
    const counts: [number, number, number, number, number] = [0, 0, 0, 0, 0];
    for (const a of world.agents) counts[a.stance + 2] = (counts[a.stance + 2] ?? 0) + 1;
    return counts;
}

export function meanStance(world: World): number {
    if (world.agents.length === 0) return 0;
    const sum = world.agents.reduce((s, a) => s + a.stance, 0);
    return Math.round((sum / world.agents.length) * 100) / 100;
}

export function summarizeRound(
    world: World,
    round: number,
    active: number,
    failed: number,
    usage: Usage
): RoundSummary {
    const acts = world.actions.filter(a => a.round === round);
    const count = (type: string) => acts.filter(a => a.action.type === type).length;
    return {
        round,
        active,
        failed,
        posts: count("create_post") + count("quote"),
        comments: count("comment"),
        likes: count("like"),
        dislikes: count("dislike"),
        shares: count("repost") + count("quote"),
        follows: count("follow"),
        meanStance: meanStance(world),
        stanceCounts: stanceCounts(world),
        usage,
    };
}

export function engagementScore(post: Post): number {
    return post.likes + 2 * post.comments + 3 * post.shares - post.dislikes;
}

export function topPosts(world: World, limit: number): Post[] {
    return world.posts
        .filter(p => p.kind !== "repost")
        .sort((a, b) => engagementScore(b) - engagementScore(a) || (a.id < b.id ? -1 : 1))
        .slice(0, limit);
}

export interface PostReception {
    postId: string;
    /** Agents whose feed showed the post (or a repost of it) at least once. */
    exposed: number;
    /** Exposed agents who liked, commented on, reposted or quoted it. */
    engaged: number;
    /** engaged / exposed, 0 when nobody saw it. */
    engagementRate: number;
    likes: number;
    dislikes: number;
    comments: number;
    shares: number;
    /** Mean final stance of exposed agents. */
    sentiment: number;
    /** Mean starting stance of exposed agents, to show movement. */
    startingSentiment: number;
    /** Comment ids on the post, oldest first. */
    commentIds: string[];
}

export function postReception(world: World, postId: string): PostReception | undefined {
    const target = world.posts.find(p => p.id === postId);
    if (!target) return undefined;
    const root = rootOf(world, target);
    const relatedIds = new Set(
        world.posts.filter(p => p.id === root.id || p.rootId === root.id).map(p => p.id)
    );
    const exposedAgents = world.agents.filter(a => (world.seen[a.persona.id] ?? []).some(id => relatedIds.has(id)));
    const engagedIds = new Set<string>();
    for (const r of world.reactions) if (r.postId === root.id && r.kind === "like") engagedIds.add(r.agentId);
    for (const c of world.comments) if (c.postId === root.id) engagedIds.add(c.authorId);
    for (const p of world.posts) if (p.rootId === root.id) engagedIds.add(p.authorId);
    const exposedIds = new Set(exposedAgents.map(a => a.persona.id));
    const engaged = [...engagedIds].filter(id => exposedIds.has(id)).length;
    const mean = (values: number[]) =>
        values.length === 0 ? 0 : Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 100) / 100;
    return {
        postId: root.id,
        exposed: exposedAgents.length,
        engaged,
        engagementRate: exposedAgents.length === 0 ? 0 : Math.round((engaged / exposedAgents.length) * 1000) / 1000,
        likes: root.likes,
        dislikes: root.dislikes,
        comments: root.comments,
        shares: root.shares,
        sentiment: mean(exposedAgents.map(a => a.stance)),
        startingSentiment: mean(exposedAgents.map(a => a.stanceHistory[0] ?? a.stance)),
        commentIds: world.comments.filter(c => c.postId === root.id).map(c => c.id),
    };
}

export type FactionKey = "supportive" | "neutral" | "critical";

export function factionOf(stance: Stance): FactionKey {
    return stance > 0 ? "supportive" : stance < 0 ? "critical" : "neutral";
}

export function factions(world: World): Record<FactionKey, string[]> {
    const out: Record<FactionKey, string[]> = { supportive: [], neutral: [], critical: [] };
    for (const a of world.agents) out[factionOf(a.stance)].push(a.persona.id);
    return out;
}

export interface StanceShift {
    agentId: string;
    from: Stance;
    to: Stance;
}

export function stanceShifts(world: World, limit: number): StanceShift[] {
    return world.agents
        .map(a => ({ agentId: a.persona.id, from: a.stanceHistory[0] ?? a.stance, to: a.stance }))
        .filter(s => s.from !== s.to)
        .sort((x, y) => Math.abs(y.to - y.from) - Math.abs(x.to - x.from) || (x.agentId < y.agentId ? -1 : 1))
        .slice(0, limit);
}

export function totalUsage(world: World): Usage {
    return world.rounds.reduce(
        (sum, r) => ({
            calls: sum.calls + r.usage.calls,
            inputTokens: sum.inputTokens + r.usage.inputTokens,
            outputTokens: sum.outputTokens + r.usage.outputTokens,
        }),
        { calls: 0, inputTokens: 0, outputTokens: 0 }
    );
}
