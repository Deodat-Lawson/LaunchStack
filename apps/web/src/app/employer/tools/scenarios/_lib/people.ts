/**
 * What the screens say about a person beyond their profile, read off the
 * run: the line they are remembered by, how they moved round by round and
 * what they said on the way, and who did the talking. Plain data, no React.
 */
import type {
    ScenarioComment,
    ScenarioPerson,
    ScenarioPost,
    Stance,
} from "~/lib/scenarios/types";

/** Something a person said: a post of their own, or a reply under someone else's. */
export type Said =
    | { kind: "post"; round: number; post: ScenarioPost }
    | { kind: "reply"; round: number; comment: ScenarioComment; post: ScenarioPost };

/** How much a post was answered: what a feed would rank it by. */
function weight(post: ScenarioPost): number {
    return post.likes + 2 * post.shares + 2 * post.comments.length;
}

/**
 * The line a person is remembered by: their most-answered post with words of
 * its own, else their most recent reply, else nothing (they read along).
 */
export function signatureLine(
    person: ScenarioPerson,
    posts: readonly ScenarioPost[]
): { text: string; round: number } | null {
    let best: ScenarioPost | null = null;
    for (const post of posts) {
        if (post.authorId !== person.id || !post.text.trim()) continue;
        if (!best || weight(post) > weight(best)) best = post;
    }
    if (best) return { text: best.text, round: best.round };
    let reply: ScenarioComment | null = null;
    for (const post of posts) {
        for (const c of post.comments) {
            if (c.authorId === person.id && (!reply || c.round >= reply.round)) reply = c;
        }
    }
    return reply ? { text: reply.text, round: reply.round } : null;
}

/** Everything a person posted or replied, oldest first. */
export function saidBy(person: ScenarioPerson, posts: readonly ScenarioPost[]): Said[] {
    const out: Said[] = [];
    for (const post of posts) {
        if (post.authorId === person.id) out.push({ kind: "post", round: post.round, post });
        for (const comment of post.comments) {
            if (comment.authorId === person.id) {
                out.push({ kind: "reply", round: comment.round, comment, post });
            }
        }
    }
    return out.sort((a, b) => a.round - b.round);
}

/** One step of a person's run: a round they spoke in, moved in, or both. */
export interface JourneyStep {
    round: number;
    /** Where they stood before the round, and after it. */
    from: Stance;
    stance: Stance;
    /** Their stance moved during this round (from the round before). */
    moved: boolean;
    said: Said[];
}

/**
 * The rounds that matter for one person — where their stance moved or they
 * said something — after where they started (round 0).
 */
export function journey(person: ScenarioPerson, posts: readonly ScenarioPost[]): JourneyStep[] {
    const history = person.stanceHistory.length ? person.stanceHistory : [person.startStance];
    const said = saidBy(person, posts);
    const lastRound = Math.max(history.length - 1, ...said.map(s => s.round));
    const steps: JourneyStep[] = [];
    for (let round = 1; round <= lastRound; round++) {
        const stance = history[Math.min(round, history.length - 1)] ?? person.stance;
        const before = history[Math.min(round - 1, history.length - 1)] ?? person.startStance;
        const inRound = said.filter(s => s.round === round);
        const moved = stance !== before;
        if (moved || inRound.length > 0) {
            steps.push({ round, from: before, stance, moved, said: inRound });
        }
    }
    return steps;
}

/**
 * The stance a person moved to during a round, or null when they held: for
 * marking the post where someone changed their mind.
 */
export function movedTo(person: ScenarioPerson | undefined, round: number): Stance | null {
    if (!person || round < 1) return null;
    const now = person.stanceHistory[round];
    const before = person.stanceHistory[round - 1];
    if (now === undefined || before === undefined || now === before) return null;
    return now;
}

/** The people who said the most (posts and replies), the most-answered first among equals. */
export function mostVocal(
    people: readonly ScenarioPerson[],
    posts: readonly ScenarioPost[],
    limit: number
): ScenarioPerson[] {
    const answered = new Map<string, number>();
    for (const post of posts) {
        answered.set(post.authorId, (answered.get(post.authorId) ?? 0) + weight(post));
    }
    return [...people]
        .filter(p => p.posts + p.comments > 0)
        .sort(
            (a, b) =>
                b.posts + b.comments - (a.posts + a.comments) ||
                (answered.get(b.id) ?? 0) - (answered.get(a.id) ?? 0)
        )
        .slice(0, limit);
}
