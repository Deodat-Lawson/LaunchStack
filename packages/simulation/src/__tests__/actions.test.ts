import { describe, expect, it } from "vitest";

import { applyAction } from "../actions";
import { parseDecision } from "../decide";
import { buildFeeds } from "../recommend";
import { createRng } from "../rng";
import { addPost } from "../world";
import { smallWorld } from "./helpers";

describe("applyAction (OASIS platform rules)", () => {
    it("allows one like per post and no liking your own post", () => {
        const world = smallWorld();
        const own = addPost(world, { authorId: "a1", round: 0, kind: "post", text: "mine" });
        expect(applyAction(world, "a1", { type: "like", postId: "p1" }, 1)).toEqual({ ok: true });
        expect(applyAction(world, "a1", { type: "like", postId: "p1" }, 1).ok).toBe(false);
        expect(applyAction(world, "a1", { type: "like", postId: own.id }, 1).ok).toBe(false);
        expect(world.posts[0]!.likes).toBe(1);
    });

    it("resolves likes, comments, reposts and quotes of a repost to the root", () => {
        const world = smallWorld();
        const repost = applyAction(world, "a2", { type: "repost", postId: "p1" }, 1);
        expect(repost.ok && repost.createdId).toBe("p2");
        applyAction(world, "a3", { type: "like", postId: "p2" }, 1);
        applyAction(world, "a3", { type: "comment", postId: "p2", text: "hm" }, 1);
        applyAction(world, "a4", { type: "repost", postId: "p2" }, 1);
        applyAction(world, "a4", { type: "quote", postId: "p2", text: "worth reading" }, 1);
        const root = world.posts[0]!;
        expect(root).toMatchObject({ likes: 1, comments: 1, shares: 3 });
        expect(world.comments[0]!.postId).toBe("p1");
        expect(world.posts.filter(p => p.rootId === "p1")).toHaveLength(3);
    });

    it("allows one repost per root and no following yourself or twice", () => {
        const world = smallWorld();
        expect(applyAction(world, "a2", { type: "repost", postId: "p1" }, 1).ok).toBe(true);
        expect(applyAction(world, "a2", { type: "repost", postId: "p1" }, 1).ok).toBe(false);
        world.follows = [];
        expect(applyAction(world, "a1", { type: "follow", agentId: "a1" }, 1).ok).toBe(false);
        expect(applyAction(world, "a1", { type: "follow", agentId: "a2" }, 1).ok).toBe(true);
        expect(applyAction(world, "a1", { type: "follow", agentId: "a2" }, 1).ok).toBe(false);
        expect(applyAction(world, "a1", { type: "follow", agentId: "narrator" }, 1).ok).toBe(false);
    });
});

describe("parseDecision", () => {
    const setup = () => {
        const world = smallWorld();
        const feed = buildFeeds(world, ["a1"], createRng(1)).get("a1")!;
        return { world, agent: world.agents[0]!, feed };
    };

    it("keeps valid actions, maps aliases, and drops posts outside the feed", () => {
        const ctx = setup();
        const reply = JSON.stringify({
            thought: "Too expensive.",
            stance: -5,
            actions: [
                { type: "like_post", postId: "p1" },
                { type: "create_comment", postId: "1", text: "No way." },
                { type: "like", postId: "p99" },
                { type: "follow", handle: "person_a2" },
            ],
        });
        const d = parseDecision(reply, ctx)!;
        expect(d.stance).toBe(-2);
        expect(d.actions).toEqual([
            { type: "like", postId: "p1" },
            { type: "comment", postId: "p1", text: "No way." },
            { type: "follow", agentId: "a2" },
        ]);
    });

    it("reads fenced JSON, caps actions, and falls back to doing nothing", () => {
        const ctx = setup();
        const many = {
            thought: "",
            stance: 1,
            actions: Array.from({ length: 6 }, (_, i) => ({ type: "create_post", text: `t${i}` })),
        };
        expect(
            parseDecision("```json\n" + JSON.stringify(many) + "\n```", ctx)!.actions
        ).toHaveLength(3);
        expect(
            parseDecision(
                '{"thought":"meh","stance":0,"actions":[{"type":"like","postId":"p42"}]}',
                ctx
            )!.actions
        ).toEqual([{ type: "do_nothing" }]);
        expect(parseDecision("I would like the post.", ctx)).toBeUndefined();
    });

    it("refuses to follow yourself and ignores comments with no text", () => {
        const ctx = setup();
        const d = parseDecision(
            JSON.stringify({
                thought: "",
                stance: 0,
                actions: [
                    { type: "follow", handle: "@person_a1" },
                    { type: "comment", postId: "p1", text: " " },
                ],
            }),
            ctx
        )!;
        expect(d.actions).toEqual([{ type: "do_nothing" }]);
    });
});
