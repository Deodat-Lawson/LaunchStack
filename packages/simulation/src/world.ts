/**
 * Creating a world, looking things up in it, and injecting events between rounds.
 */

import { createRng, hashSeed, type Rng } from "./rng";
import { clip, cosine, idf, tfidf, tokenize } from "./text";
import {
    DEFAULT_CONFIG,
    type Account,
    type AgentState,
    type Persona,
    type Post,
    type SimulationConfig,
    type World,
} from "./types";

export const MAX_POST_CHARS = 500;
export const MAX_COMMENT_CHARS = 300;

export interface CreateWorldInput {
    subject: string;
    brief: string;
    personas: Persona[];
    accounts?: Account[];
    /** Posts that exist before round 1: the scenario's opening post, or the draft under test. */
    seedPosts?: Array<{ authorId: Account["id"]; text: string }>;
    config?: Partial<SimulationConfig>;
    /** Mean accounts each agent follows at the start (default 4). */
    meanFollows?: number;
}

export function createWorld(input: CreateWorldInput): World {
    const config: SimulationConfig = { ...DEFAULT_CONFIG, ...input.config };
    const handles = new Set<string>();
    for (const p of input.personas) {
        if (handles.has(p.handle)) throw new Error(`Duplicate handle ${p.handle}`);
        handles.add(p.handle);
    }
    const agents: AgentState[] = input.personas.map(persona => ({
        persona,
        stance: persona.stance,
        stanceHistory: [persona.stance],
        memory: [],
        activeRounds: [],
    }));
    const world: World = {
        version: 1,
        round: 0,
        subject: input.subject,
        brief: input.brief,
        config,
        accounts: input.accounts ?? [],
        agents,
        posts: [],
        comments: [],
        reactions: [],
        follows: [],
        seen: Object.fromEntries(agents.map(a => [a.persona.id, []])),
        actions: [],
        rounds: [],
        nextPost: 1,
        nextComment: 1,
    };
    for (const seed of input.seedPosts ?? []) {
        if (!world.accounts.some(a => a.id === seed.authorId)) {
            throw new Error(`Seed post author ${seed.authorId} is not an account in this world`);
        }
        addPost(world, { authorId: seed.authorId, round: 0, kind: "seed", text: seed.text });
    }
    world.follows = buildInitialFollows(
        input.personas,
        createRng(hashSeed(config.seed, "follows")),
        input.meanFollows ?? 4
    );
    return world;
}

/**
 * The starting follow graph. OASIS loads a real graph from its dataset; we have
 * none, so each agent follows a few others, weighted by the target's influence
 * and by how much their interests overlap (homophily).
 */
export function buildInitialFollows(
    personas: Persona[],
    rng: Rng,
    meanFollows: number
): Array<[string, string]> {
    if (personas.length < 2) return [];
    const docs = personas.map(p => tokenize(`${p.role} ${p.interests.join(" ")}`));
    const weights = idf(docs);
    const vectors = docs.map(d => tfidf(d, weights));
    const out: Array<[string, string]> = [];
    personas.forEach((p, i) => {
        const want = Math.max(
            1,
            Math.min(personas.length - 1, Math.round(meanFollows - 1.5 + rng() * 3))
        );
        const pool = personas
            .map((q, j) => ({
                id: q.id,
                weight: j === i ? 0 : 0.15 + q.influence + cosine(vectors[i]!, vectors[j]!),
            }))
            .filter(c => c.weight > 0);
        for (let k = 0; k < want && pool.length > 0; k++) {
            const total = pool.reduce((s, c) => s + c.weight, 0);
            let r = rng() * total;
            let idx = 0;
            for (; idx < pool.length - 1; idx++) {
                r -= pool[idx]!.weight;
                if (r <= 0) break;
            }
            const chosen = pool.splice(idx, 1)[0]!;
            out.push([p.id, chosen.id]);
        }
    });
    return out;
}

export function addPost(
    world: World,
    post: Pick<Post, "authorId" | "round" | "kind" | "text"> & { rootId?: string }
): Post {
    const created: Post = {
        id: `p${world.nextPost++}`,
        authorId: post.authorId,
        round: post.round,
        kind: post.kind,
        text: clip(post.text, MAX_POST_CHARS),
        likes: 0,
        dislikes: 0,
        shares: 0,
        comments: 0,
    };
    if (post.rootId) created.rootId = post.rootId;
    world.posts.push(created);
    return created;
}

/**
 * Queue a narrator event for the next round. Events are visible in the round
 * they are injected for and pinned to the top of every feed for two rounds.
 */
export function injectEvent(world: World, text: string): Post {
    const trimmed = text.trim();
    if (!trimmed) throw new Error("An event needs text");
    if (!world.accounts.some(a => a.id === "narrator")) {
        world.accounts.push({ id: "narrator", name: "Newswire", handle: "@newswire" });
    }
    return addPost(world, { authorId: "narrator", round: world.round + 1, kind: "event", text: trimmed });
}

/** The first round in which a post can appear in a feed. */
export function visibleFrom(post: Post): number {
    return post.kind === "event" ? post.round : post.round + 1;
}

export function findPost(world: World, id: string): Post | undefined {
    return world.posts.find(p => p.id === id);
}

/** Reposts and quotes point at their root; everything else is its own root. */
export function rootOf(world: World, post: Post): Post {
    if (post.rootId) return findPost(world, post.rootId) ?? post;
    return post;
}

export function findAgent(world: World, id: string): AgentState | undefined {
    return world.agents.find(a => a.persona.id === id);
}

export function author(world: World, id: string): { name: string; handle: string } {
    const agent = findAgent(world, id);
    if (agent) return { name: agent.persona.name, handle: agent.persona.handle };
    const account = world.accounts.find(a => a.id === id);
    if (account) return { name: account.name, handle: account.handle };
    return { name: "Unknown", handle: "@unknown" };
}

export function followersOf(world: World, id: string): string[] {
    return world.follows.filter(([, followee]) => followee === id).map(([follower]) => follower);
}

export function followeesOf(world: World, id: string): string[] {
    return world.follows.filter(([follower]) => follower === id).map(([, followee]) => followee);
}

export function stanceLabel(stance: number): string {
    if (stance <= -1.5) return "strongly against";
    if (stance <= -0.5) return "against";
    if (stance < 0.5) return "undecided";
    if (stance < 1.5) return "in favour";
    return "strongly in favour";
}
