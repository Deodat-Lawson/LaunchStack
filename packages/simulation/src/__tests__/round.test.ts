import { describe, expect, it } from "vitest";

import { buildInterviewRequest, buildAnalystRequest } from "../interview";
import { postReception } from "../metrics";
import { RoundFailedError, runRound, selectActive } from "../round";
import { injectEvent } from "../world";
import { agentOf, chattyScript, fakeModel, smallWorld } from "./helpers";

describe("runRound", () => {
    it("runs a round: everyone active in round 1 acts, stances and memories update", async () => {
        const world = smallWorld();
        const before = structuredClone(world);
        const model = fakeModel(chattyScript);
        const { world: next, summary } = await runRound(world, { model });

        expect(world).toEqual(before); // input untouched
        expect(next.round).toBe(1);
        expect(summary).toMatchObject({
            round: 1,
            active: 4,
            failed: 0,
            posts: 4,
            likes: 4,
            comments: 4,
        });
        expect(summary.usage).toEqual({ calls: 4, inputTokens: 400, outputTokens: 80 });
        expect(next.posts[0]).toMatchObject({ id: "p1", likes: 4, comments: 4 });
        // a1 asked for -2; the guard moves a stance one step a round.
        expect(next.agents.find(a => a.persona.id === "a1")!.stance).toBe(-1);
        expect(next.agents.every(a => a.stanceHistory.length === 2)).toBe(true);
        const memory = next.agents[0]!.memory.map(m => m.text);
        expect(memory.some(t => t.startsWith("You saw @newswire"))).toBe(true);
        expect(memory.some(t => t.startsWith("You commented on @newswire's post"))).toBe(true);
        expect(next.seen.a1).toContain("p1");
    });

    it("is deterministic: the same world and replies give the same result", async () => {
        const a = await runRound(smallWorld(), { model: fakeModel(chattyScript) });
        const b = await runRound(smallWorld(), { model: fakeModel(chattyScript) });
        expect(a.world).toEqual(b.world);
    });

    it("applies actions in agent order even when replies arrive out of order", async () => {
        const slow = fakeModel(chattyScript);
        const original = slow.complete.bind(slow);
        slow.complete = async request => {
            if (agentOf(request) === "a1") await new Promise(r => setTimeout(r, 15));
            return original(request);
        };
        const ordered = await runRound(smallWorld(), { model: slow });
        const plain = await runRound(smallWorld(), { model: fakeModel(chattyScript) });
        expect(ordered.world.posts.map(p => p.text)).toEqual(plain.world.posts.map(p => p.text));
    });

    it("lets a minority of failed turns do nothing, and fails the round on a majority", async () => {
        const errors: string[] = [];
        const oneFails = fakeModel(r =>
            agentOf(r) === "a2" ? new Error("timeout") : chattyScript(r)
        );
        const { summary, world } = await runRound(smallWorld(), {
            model: oneFails,
            onAgentError: id => errors.push(id),
        });
        expect(summary.failed).toBe(1);
        expect(errors).toEqual(["a2"]);
        expect(world.agents.find(a => a.persona.id === "a2")!.activeRounds).toEqual([]);

        const mostFail = fakeModel(r => (agentOf(r) === "a1" ? chattyScript(r) : "not json"));
        await expect(runRound(smallWorld(), { model: mostFail })).rejects.toBeInstanceOf(
            RoundFailedError
        );
    });

    it("feeds an event injected between rounds into the next round's prompts", async () => {
        const model = fakeModel(chattyScript);
        let { world } = await runRound(smallWorld(), { model });
        injectEvent(world, "Breaking: a rival halves its prices.");
        const before = model.requests.length;
        ({ world } = await runRound(world, { model }));
        const round2 = model.requests.slice(before);
        expect(round2.length).toBeGreaterThan(0);
        expect(round2.every(r => r.prompt.includes("Breaking: a rival halves its prices."))).toBe(
            true
        );
        expect(round2.every(r => r.prompt.includes("(pinned)"))).toBe(true);
    });

    it("activates agents by their activity, with a floor in round 1", () => {
        const world = smallWorld();
        for (const a of world.agents) a.persona.activity = 0;
        world.config.firstRoundActivation = 0;
        expect(selectActive(world, 2)).toHaveLength(1); // never an empty round
        world.config.firstRoundActivation = 1;
        expect(selectActive(world, 1)).toHaveLength(4);
    });
});

describe("after a run", () => {
    it("measures how the opening post was received", async () => {
        const { world } = await runRound(smallWorld(), { model: fakeModel(chattyScript) });
        expect(postReception(world, "p1")).toMatchObject({
            exposed: 4,
            engaged: 4,
            engagementRate: 1,
            likes: 4,
            comments: 4,
        });
        expect(postReception(world, "p404")).toBeUndefined();
    });

    it("builds interview prompts from what the agent wrote and remembers", async () => {
        const { world } = await runRound(smallWorld(), { model: fakeModel(chattyScript) });
        const req = buildInterviewRequest(world, "a1", "Why are you against it?", [
            { question: "Hi?", answer: "Hello." },
        ]);
        expect(req.purpose).toBe("interview");
        expect(req.system).toContain("You are Person a1 (@person_a1)");
        expect(req.prompt).toContain('you posted [p2]: "a1 thinks prices matter"');
        expect(req.prompt).toContain("undecided → against");
        expect(req.prompt).toContain("Whether you'd pay for it, as you last said: no.");
        expect(req.prompt).toContain("Q: Hi?\nA: Hello.");
        expect(req.schema).toBeDefined();
        expect(() => buildInterviewRequest(world, "a9", "?")).toThrow();
        expect(buildAnalystRequest(world, "Summary.", "Who moved?").prompt).toContain(
            '@person_a1 (Operator at a small firm): undecided → against; would pay: no; held back by: "Twenty percent more for the same invoices."'
        );
    });
});
