/**
 * What the People, Feed and profile screens read off a run about one
 * person — the line they're remembered by, how they moved and what they
 * said at each turn, and who did the talking — pinned on a small run.
 */
import {
    journey,
    mostVocal,
    movedTo,
    saidBy,
    signatureLine,
} from "~/app/employer/tools/scenarios/_lib/people";
import type { ScenarioPerson, ScenarioPost, Stance } from "~/lib/scenarios/types";

function person(id: string, history: Stance[], more: Partial<ScenarioPerson> = {}): ScenarioPerson {
    return {
        id,
        name: `Person ${id}`,
        handle: `@${id}`,
        role: "Café owner",
        bio: "",
        interests: [],
        grounding: "grounded",
        sources: ["E1"],
        startStance: history[0]!,
        stance: history[history.length - 1]!,
        stanceHistory: history,
        activity: 0.5,
        followers: 10,
        following: 5,
        posts: 0,
        comments: 0,
        lastThought: null,
        currentSolution: null,
        budget: null,
        buyingRole: null,
        switchingCost: null,
        firstObjection: null,
        wouldPay: null,
        objection: null,
        ...more,
    };
}

function post(id: string, authorId: string, round: number, more: Partial<ScenarioPost> = {}) {
    return {
        id,
        authorId,
        authorName: `Person ${authorId}`,
        authorHandle: authorId,
        authorKind: "agent",
        round,
        kind: "post",
        text: `post ${id}`,
        root: null,
        likes: 0,
        dislikes: 0,
        shares: 0,
        comments: [],
        ...more,
    } satisfies ScenarioPost;
}

const comment = (id: string, authorId: string, round: number, text = `reply ${id}`) => ({
    id,
    authorId,
    authorName: `Person ${authorId}`,
    authorHandle: authorId,
    round,
    text,
});

describe("signatureLine", () => {
    it("is the most-answered post with words of its own", () => {
        const maya = person("maya", [0, -1]);
        const posts = [
            post("p1", "maya", 1, { likes: 2 }),
            post("p2", "maya", 2, { likes: 1, shares: 1, comments: [comment("c1", "tom", 2)] }),
            // A repost has no words of its own, however far it went.
            post("p3", "maya", 2, { kind: "repost", text: "", shares: 40 }),
            post("p4", "tom", 1, { likes: 50 }),
        ];
        expect(signatureLine(maya, posts)).toEqual({ text: "post p2", round: 2 });
    });

    it("falls back to the latest reply, then to nothing", () => {
        const quiet = person("quiet", [0, 0]);
        const posts = [
            post("p1", "tom", 1, {
                comments: [comment("c1", "quiet", 1, "first"), comment("c2", "quiet", 3, "later")],
            }),
        ];
        expect(signatureLine(quiet, posts)).toEqual({ text: "later", round: 3 });
        expect(signatureLine(quiet, [post("p2", "tom", 1)])).toBeNull();
    });
});

describe("journey", () => {
    it("keeps the rounds where they moved or spoke, with where they came from", () => {
        const maya = person("maya", [0, -1, -1, -2, -1]);
        const posts = [
            post("p1", "maya", 1),
            post("p2", "tom", 2, { comments: [comment("c1", "maya", 2)] }),
        ];
        const steps = journey(maya, posts);
        expect(steps.map(s => [s.round, s.from, s.stance, s.moved, s.said.length])).toEqual([
            [1, 0, -1, true, 1],
            [2, -1, -1, false, 1],
            [3, -1, -2, true, 0],
            [4, -2, -1, true, 0],
        ]);
        expect(steps[1]!.said[0]).toMatchObject({ kind: "reply", post: { id: "p2" } });
    });

    it("is empty for someone who held still and said nothing", () => {
        expect(journey(person("still", [1, 1, 1]), [])).toEqual([]);
    });
});

describe("saidBy", () => {
    it("lists posts and replies oldest first", () => {
        const maya = person("maya", [0]);
        const posts = [
            post("p1", "tom", 1, { comments: [comment("c1", "maya", 3)] }),
            post("p2", "maya", 2),
        ];
        expect(saidBy(maya, posts).map(s => s.round)).toEqual([2, 3]);
    });
});

describe("movedTo", () => {
    it("names the stance someone moved to during a round, or null when they held", () => {
        const maya = person("maya", [0, -1, -1]);
        expect(movedTo(maya, 1)).toBe(-1);
        expect(movedTo(maya, 2)).toBeNull();
        expect(movedTo(maya, 0)).toBeNull();
        expect(movedTo(maya, 9)).toBeNull();
        expect(movedTo(undefined, 1)).toBeNull();
    });
});

describe("mostVocal", () => {
    it("ranks by what they said, the most-answered first among equals, and leaves out the silent", () => {
        const people = [
            person("a", [0], { posts: 1, comments: 1 }),
            person("b", [0], { posts: 2, comments: 0 }),
            person("c", [0], { posts: 3, comments: 2 }),
            person("d", [0]),
        ];
        const posts = [post("p1", "a", 1, { likes: 1 }), post("p2", "b", 1, { likes: 9 })];
        expect(mostVocal(people, posts, 5).map(p => p.id)).toEqual(["c", "b", "a"]);
        expect(mostVocal(people, posts, 1).map(p => p.id)).toEqual(["c"]);
    });
});
