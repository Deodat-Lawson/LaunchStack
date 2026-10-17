import { describe, expect, it } from "vitest";

import { applyAction } from "../actions";
import { buildFeeds, hotScore, timeDecay } from "../recommend";
import { createRng } from "../rng";
import { addPost, createWorld, injectEvent, visibleFrom } from "../world";
import { persona, smallWorld } from "./helpers";

const rng = () => createRng(1);

describe("hot score and time decay (OASIS formulas)", () => {
    it("matches Reddit's hot score: sign × log10(|likes − dislikes|) + seconds / 45000", () => {
        expect(hotScore(10, 0, 0, 20)).toBeCloseTo(1, 6);
        expect(hotScore(0, 100, 0, 20)).toBeCloseTo(-2, 6);
        expect(hotScore(1, 1, 3, 20)).toBeCloseTo((3 * 20 * 60) / 45000, 6);
    });

    it("matches ln((271.8 − age) / 100) and floors at 0.05", () => {
        expect(timeDecay(0, 20)).toBeCloseTo(Math.log(2.718), 6);
        expect(timeDecay(2, 20)).toBeCloseTo(Math.log(2.318), 6);
        expect(timeDecay(50, 20)).toBe(0.05);
    });
});

describe("buildFeeds", () => {
    it("pins the opening post in round 1 and never shows an agent its own posts", () => {
        const world = smallWorld();
        addPost(world, { authorId: "a1", round: 0, kind: "post", text: "my own take on prices" });
        const feeds = buildFeeds(world, ["a1", "a2"], rng());
        expect(feeds.get("a1")![0]).toMatchObject({ postId: "p1", reason: "pinned" });
        expect(feeds.get("a1")!.map(f => f.postId)).not.toContain("p2");
        expect(feeds.get("a2")!.map(f => f.postId)).toContain("p2");
    });

    it("hides posts made in the current round until the next round", () => {
        const world = smallWorld();
        const post = addPost(world, { authorId: "a2", round: 1, kind: "post", text: "fresh" });
        expect(visibleFrom(post)).toBe(2);
        expect(buildFeeds(world, ["a1"], rng()).get("a1")!.map(f => f.postId)).not.toContain(post.id);
        world.round = 1;
        expect(buildFeeds(world, ["a1"], rng()).get("a1")!.map(f => f.postId)).toContain(post.id);
    });

    it("shows an injected event, pinned, in the very next round", () => {
        const world = smallWorld();
        world.round = 3;
        const event = injectEvent(world, "A competitor cuts prices by half.");
        const feed = buildFeeds(world, ["a2"], rng()).get("a2")!;
        expect(feed[0]).toMatchObject({ postId: event.id, reason: "pinned", kind: "event" });
    });

    it("adds the most-liked posts of followed accounts", () => {
        const world = smallWorld();
        world.follows = [["a1", "a2"]];
        world.round = 1;
        const quiet = addPost(world, { authorId: "a2", round: 0, kind: "post", text: "quiet note" });
        const loud = addPost(world, { authorId: "a2", round: 0, kind: "post", text: "loud note" });
        loud.likes = 9;
        world.config.followingCount = 1;
        const feed = buildFeeds(world, ["a1"], rng()).get("a1")!;
        expect(feed.find(f => f.reason === "following")?.postId).toBe(loud.id);
        expect(feed.find(f => f.postId === quiet.id)?.reason).not.toBe("following");
    });

    it("ranks posts by interest overlap with the agent's profile", () => {
        const world = createWorld({
            subject: "s",
            brief: "",
            personas: [
                persona("a1", { role: "Gardener", bio: "Grows tomatoes and roses.", interests: ["tomatoes", "roses", "compost"] }),
                persona("a2"),
            ],
            config: { swapRate: 0, recommendCount: 1 },
        });
        world.round = 1;
        addPost(world, { authorId: "a2", round: 0, kind: "post", text: "quarterly invoicing software pricing update" });
        const garden = addPost(world, { authorId: "a2", round: 0, kind: "post", text: "best compost for tomatoes and roses" });
        world.follows = [];
        const feed = buildFeeds(world, ["a1"], rng()).get("a1")!;
        expect(feed.map(f => f.postId)).toEqual([garden.id]);
    });

    it("down-weights posts an agent has already been shown", () => {
        const world = createWorld({
            subject: "s",
            brief: "",
            personas: [persona("a1", { interests: ["pricing"] }), persona("a2")],
            config: { swapRate: 0, recommendCount: 1 },
        });
        world.follows = [];
        world.round = 1;
        const first = addPost(world, { authorId: "a2", round: 0, kind: "post", text: "pricing pricing pricing" });
        const second = addPost(world, { authorId: "a2", round: 0, kind: "post", text: "pricing news" });
        expect(buildFeeds(world, ["a1"], rng()).get("a1")![0]!.postId).toBe(first.id);
        world.seen.a1 = [first.id];
        expect(buildFeeds(world, ["a1"], rng()).get("a1")![0]!.postId).toBe(second.id);
    });

    it("swaps recommendations for random posts at the swap rate", () => {
        const world = smallWorld();
        world.round = 1;
        for (let i = 0; i < 12; i++) addPost(world, { authorId: "a2", round: 0, kind: "post", text: `post number ${i}` });
        world.follows = [];
        world.config.swapRate = 1;
        const feed = buildFeeds(world, ["a1"], rng()).get("a1")!;
        expect(feed.filter(f => f.reason === "random").length).toBeGreaterThan(0);
        expect(feed.filter(f => f.reason === "recommended").length).toBe(0);
    });

    it("shows a repost with its root and the root's counts", () => {
        const world = smallWorld();
        world.round = 1;
        expect(applyAction(world, "a2", { type: "repost", postId: "p1" }, 1).ok).toBe(true);
        world.round = 2;
        world.follows = [["a1", "a2"]];
        const item = buildFeeds(world, ["a1"], rng()).get("a1")!.find(f => f.kind === "repost")!;
        expect(item.root).toEqual({ handle: "@newswire", text: "Acme announces a 20% price increase for all plans." });
        expect(item.shares).toBe(1);
    });
});

describe("createWorld", () => {
    it("builds the same follow graph for the same seed", () => {
        const a = smallWorld({ seed: 3 });
        const b = smallWorld({ seed: 3 });
        expect(a.follows).toEqual(b.follows);
        expect(a.follows.every(([x, y]) => x !== y)).toBe(true);
    });

    it("rejects duplicate handles", () => {
        expect(() =>
            createWorld({ subject: "s", brief: "", personas: [persona("a1"), persona("a2", { handle: "@person_a1" })] })
        ).toThrow(/Duplicate handle/);
    });
});
