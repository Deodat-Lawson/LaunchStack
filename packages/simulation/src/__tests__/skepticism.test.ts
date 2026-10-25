import { describe, expect, it } from "vitest";

import {
    ALL_AGAINST,
    buildCastRequest,
    fillSeats,
    mixCounts,
    parseCast,
    REALISTIC_MIX,
    seatsToRecast,
    skepticShortfall,
} from "../cast";
import { buildDecisionRequest, parseDecision, personaSystem } from "../decide";
import { wouldPayCounts } from "../metrics";
import { buildReportRequest } from "../report";
import { guardStance, runRound } from "../round";
import type { Persona } from "../types";
import { agentOf, chattyScript, fakeModel, feedIds, persona, smallWorld } from "./helpers";

describe("stance guard", () => {
    const config = { maxStanceStep: 1, warmingNeedsReason: true };

    it("moves a stance at most one step a round, either way", () => {
        expect(guardStance(-2, { stance: 2, convincedBy: "p1" }, config)).toBe(-1);
        expect(guardStance(2, { stance: -2 }, config)).toBe(1);
        expect(guardStance(0, { stance: 0 }, config)).toBe(0);
    });

    it("keeps a stance that warms with no post behind it, and lets one cool without", () => {
        expect(guardStance(-1, { stance: 0 }, config)).toBe(-1);
        expect(guardStance(-1, { stance: 0, convincedBy: "p3" }, config)).toBe(0);
        expect(guardStance(1, { stance: 0 }, config)).toBe(0);
    });

    it("follows the world's config, and defaults for worlds saved before it existed", () => {
        expect(
            guardStance(-2, { stance: 2 }, { maxStanceStep: 4, warmingNeedsReason: false })
        ).toBe(2);
        expect(guardStance(0, { stance: 2, convincedBy: "p1" }, { maxStanceStep: 2 })).toBe(2);
        expect(guardStance(0, { stance: 2 }, {})).toBe(0);
        expect(guardStance(0, { stance: 2, convincedBy: "p1" }, {})).toBe(1);
    });

    it("holds in a round: a cited post outside the feed doesn't count", async () => {
        const model = fakeModel(request => {
            if (request.purpose !== "decide") return {};
            const agent = agentOf(request);
            const first = feedIds(request.prompt)[0] ?? null;
            return {
                thought: "Sold.",
                stance: 2,
                // a1 credits a post it never saw; a2 credits its feed's first post.
                convincedBy: agent === "a1" ? "p99" : first,
                wouldPay: agent === "a2" ? "yes" : "maybe",
                objection: agent === "a2" ? null : "Not sure it's worth it.",
                actions: [{ type: "do_nothing", postId: null, text: null, handle: null }],
            };
        });
        const { world, summary } = await runRound(smallWorld(), { model });
        const stance = (id: string) => world.agents.find(a => a.persona.id === id)!.stance;
        expect(stance("a1")).toBe(0);
        expect(stance("a2")).toBe(1);
        expect(summary.wouldPayCounts).toEqual([1, 3, 0]);
        expect(world.agents.find(a => a.persona.id === "a1")).toMatchObject({
            wouldPay: "maybe",
            objection: "Not sure it's worth it.",
        });
        expect(world.agents.find(a => a.persona.id === "a2")!.objection).toBeUndefined();
    });
});

describe("turns", () => {
    it("ask whether they'd pay and what holds them back, and remind them next round", async () => {
        const model = fakeModel(chattyScript);
        const { world } = await runRound(smallWorld(), { model });
        const a1 = world.agents.find(a => a.persona.id === "a1")!;
        const req = buildDecisionRequest(world, a1, []);
        expect(req.schema?.required).toEqual([
            "thought",
            "stance",
            "convincedBy",
            "wouldPay",
            "objection",
            "actions",
        ]);
        expect(req.prompt).toContain("It moves at most one step from where you are.");
        expect(req.prompt).toContain(
            "Last time you thought about paying for it, your answer was: no."
        );
        expect(req.prompt).toContain(
            'What held you back last time: "Twenty percent more for the same invoices."'
        );
        // Blank lines between blocks survive.
        expect(req.prompt).toContain("\n\nYour feed:\nNothing new in your feed.\n\n");
        expect(req.system).toContain("Spend the way this person spends.");
    });

    it("parse would-pay and objection leniently and drop what isn't an answer", () => {
        const world = smallWorld();
        const agent = world.agents[0]!;
        const feed = [
            {
                postId: "p1",
                authorId: "narrator",
                authorName: "Newswire",
                authorHandle: "@newswire",
                kind: "seed" as const,
                text: "x",
                likes: 0,
                shares: 0,
                comments: 0,
                recentComments: [],
                reason: "pinned" as const,
            },
        ];
        const parse = (reply: unknown) =>
            parseDecision(JSON.stringify(reply), { world, agent, feed })!;
        expect(
            parse({
                thought: "t",
                stance: 1,
                convincedBy: "P1",
                wouldPay: " Maybe ",
                objection: "Price.",
                actions: [],
            })
        ).toMatchObject({ convincedBy: "p1", wouldPay: "maybe", objection: "Price." });
        const vague = parse({
            thought: "t",
            stance: 1,
            convincedBy: "p7",
            wouldPay: "sure",
            objection: "null",
            actions: [],
        });
        expect(vague.convincedBy).toBeUndefined();
        expect(vague.wouldPay).toBeUndefined();
        expect(vague.objection).toBeUndefined();
    });
});

describe("wallet", () => {
    it("tells the persona what they use, what they can spend and what switching costs", () => {
        const world = smallWorld({
            personas: [
                persona("a1", {
                    currentSolution: "Competitor B on an annual plan",
                    budget: "tight",
                    buyingRole: "influences",
                    switchingCost: "high",
                    objection: "I'd be moving everything for features I'd barely use.",
                }),
                persona("a2", { currentSolution: "nothing", budget: "none" }),
                persona("a3"),
            ],
        });
        const [a1, a2, a3] = world.agents;
        const one = personaSystem(world, a1!);
        expect(one).toContain("For this today you use: Competitor B on an annual plan.");
        expect(one).toContain("Money is tight");
        expect(one).toContain("someone else signs off");
        expect(one).toContain("Switching would cost you a lot");
        expect(one).toContain("Your first doubt: \"I'd be moving everything");
        expect(personaSystem(world, a2!)).toContain("You don't pay for anything like this today.");
        // A persona cast before wallets existed reads as it always did.
        expect(personaSystem(world, a3!)).not.toMatch(/today|Money|Switching|doubt/);
    });
});

describe("starting mix", () => {
    it("rounds to whole people, giving ties to the warier side", () => {
        expect(mixCounts(10, REALISTIC_MIX)).toEqual({ against: 4, undecided: 4, inFavour: 2 });
        expect(mixCounts(6, REALISTIC_MIX)).toEqual({ against: 2, undecided: 2, inFavour: 2 });
        expect(mixCounts(3, ALL_AGAINST)).toEqual({ against: 3, undecided: 0, inFavour: 0 });
        expect(mixCounts(0, REALISTIC_MIX)).toEqual({ against: 0, undecided: 0, inFavour: 0 });
    });

    it("asks each batch for its share of skeptics and for a wallet", () => {
        const req = buildCastRequest({
            subject: "s",
            brief: "",
            evidence: [],
            count: 10,
            takenHandles: [],
            audience: "customers",
            maxInvented: 10,
        });
        expect(req.prompt).toContain(
            "Starting stances for these 10: 4 against (-1 or -2), 4 undecided (0), 2 in favour (1 or 2)."
        );
        expect(req.system).toContain("never make up a product name");
        expect(req.system).not.toContain("Vary them");
        const all = buildCastRequest({
            subject: "s",
            brief: "",
            evidence: [],
            count: 2,
            takenHandles: [],
            audience: "customers",
            maxInvented: 2,
            mix: ALL_AGAINST,
        });
        expect(all.prompt).toContain("2 against (-1 or -2), 0 undecided (0), 0 in favour");
    });

    it("reads the wallet, falling back to the cautious middle", () => {
        const base = {
            name: "Ana Ruiz",
            handle: "@ana",
            role: "Bookkeeper",
            bio: "x",
            interests: [],
            stance: -1,
            activity: 0.3,
            influence: 0.2,
            sourceIds: [],
            invented: true,
        };
        const out = parseCast(
            JSON.stringify({
                personas: [
                    {
                        ...base,
                        currentSolution: " Spreadsheets ",
                        budget: "FUNDED",
                        buyingRole: "decides",
                        switchingCost: "low",
                        objection: "Another login to remember.",
                    },
                    { ...base, handle: "@bo", budget: "lots", buyingRole: 3 },
                ],
            }),
            { evidenceIds: new Set(), startIndex: 1, takenHandles: new Set(), limit: 5 }
        );
        expect(out[0]).toMatchObject({
            currentSolution: "Spreadsheets",
            budget: "funded",
            buyingRole: "decides",
            switchingCost: "low",
            objection: "Another login to remember.",
        });
        expect(out[1]).toMatchObject({
            budget: "tight",
            buyingRole: "uses",
            switchingCost: "medium",
        });
        expect(out[1]).not.toHaveProperty("currentSolution");
        expect(out[1]).not.toHaveProperty("objection");
    });

    it("finds a warm cast's shortfall and recasts invented, then undecided, then fans", () => {
        const cast: Persona[] = [
            persona("a1", { stance: -1 }),
            persona("a2", { stance: 2 }),
            persona("a3", { stance: 1, grounding: "invented", sourceIds: [] }),
            persona("a4", { stance: 0 }),
            persona("a5", { stance: 0, grounding: "invented", sourceIds: [] }),
            persona("a6", { stance: 1 }),
        ];
        // Six people want two against; one is.
        expect(skepticShortfall(cast, REALISTIC_MIX)).toBe(1);
        expect(skepticShortfall(cast, ALL_AGAINST)).toBe(5);
        expect(seatsToRecast(cast, 5)).toEqual(["a3", "a5", "a4", "a2", "a6"]);
        expect(seatsToRecast(cast, 0)).toEqual([]);
    });

    it("fills seats in place, keeping ids and starting every newcomer against", () => {
        const cast = [persona("a1"), persona("a2", { stance: 2 }), persona("a3", { stance: 1 })];
        const newcomers = [
            persona("x1", { name: "New One", stance: 1 }),
            persona("x2", { name: "New Two", stance: -2 }),
        ];
        const out = fillSeats(cast, ["a2", "a3", "a1"], newcomers);
        expect(out.map(p => [p.id, p.name, p.stance])).toEqual([
            ["a1", "Person a1", 0],
            ["a2", "New One", -1],
            ["a3", "New Two", -2],
        ]);
    });
});

describe("report", () => {
    it("sets would-pay against sentiment when people were asked", async () => {
        const { world } = await runRound(smallWorld(), { model: fakeModel(chattyScript) });
        expect(wouldPayCounts(world)).toEqual([0, 3, 1]);
        const req = buildReportRequest(world);
        expect(req.prompt).toContain(
            "Would pay at the end, of the 4 who answered: yes 0, maybe 3, no 1."
        );
        expect(req.prompt).toContain(
            '@person_a1 (Operator at a small firm): "Twenty percent more for the same invoices."'
        );
        expect(req.system).toContain("Liking the subject and paying for it are different");
        expect(buildReportRequest(smallWorld()).prompt).not.toContain("Would pay");
    });
});
