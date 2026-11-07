import { describe, expect, it } from "vitest";

import type { ModelRequest, SimulationModel } from "@launchstack/simulation";

import { buildEvidence } from "./evidence";
import { actualEngagement, buildTrackRecord, hashDraft, normalizeDraft } from "./post-tests";
import { advanceRun, type RunPatch, type ScenarioRunPorts, type ScenarioStore } from "./run";
import type { ScenarioRunRecord, StoredEvidence } from "./types";
import { EMPTY_USAGE, roundsDone, stageOf, unitCount } from "./types";

const EVIDENCE: StoredEvidence[] = buildEvidence([
    {
        kind: "document",
        label: "Interviews.pdf",
        text: "Customers say price drives churn.",
        ref: { type: "document", id: "7" },
        href: "/doc/7",
    },
    {
        kind: "brand_comment",
        label: "Comment on LinkedIn",
        text: "Renewal emails annoy me.",
        ref: { type: "brand_comment", id: "3" },
        href: null,
    },
]);

function baseRun(overrides: Partial<ScenarioRunRecord> = {}): ScenarioRunRecord {
    return {
        id: 1,
        companyId: 5n,
        createdByUserId: "u1",
        kind: "scenario",
        title: "Price rise",
        subject: "We raise prices 20% in January.",
        status: "queued",
        step: 0,
        agentCount: 6,
        roundCount: 2,
        seed: 11,
        sources: {
            documentIds: [7],
            searchFiles: false,
            prospects: false,
            brandComments: true,
            companyProfile: false,
            notes: "",
        },
        evidence: null,
        brief: null,
        world: null,
        report: null,
        reception: null,
        estimate: { calls: 20, inputTokens: 1000, outputTokens: 100, credits: 1100 },
        usage: EMPTY_USAGE,
        draft: null,
        draftHash: null,
        error: null,
        sharedAt: null,
        cancelRequestedAt: null,
        leaseUntil: null,
        createdAt: new Date("2026-10-17T00:00:00Z"),
        startedAt: null,
        finishedAt: null,
        eventsClosedAt: null,
        ...overrides,
    };
}

function memoryStore(initial: ScenarioRunRecord) {
    const runs = new Map([[initial.id, structuredClone(initial)]]);
    const injections: Array<{
        id: number;
        runId: number;
        text: string;
        appliedRound: number | null;
    }> = [];
    const calls: string[] = [];
    const store: ScenarioStore & {
        runs: typeof runs;
        injections: typeof injections;
        calls: string[];
    } = {
        runs,
        injections,
        calls,
        async get(id) {
            const r = runs.get(id);
            return r ? structuredClone(r) : undefined;
        },
        async commitUnit(id, expected, patch: RunPatch, applied) {
            const r = runs.get(id);
            if (!r || r.step !== expected || !["queued", "running"].includes(r.status))
                return false;
            Object.assign(r, patch, { step: expected + 1 });
            if (applied)
                for (const i of injections)
                    if (applied.injectionIds.includes(i.id)) i.appliedRound = applied.round;
            return true;
        },
        async finish(id, status, error, at) {
            const r = runs.get(id)!;
            if (!["queued", "running"].includes(r.status)) return false;
            Object.assign(r, { status, error, finishedAt: at });
            return true;
        },
        async markStarted(id, at) {
            const r = runs.get(id)!;
            if (r.status === "queued") Object.assign(r, { status: "running", startedAt: at });
        },
        async closeEvents(id, at) {
            calls.push("closeEvents");
            const r = runs.get(id)!;
            r.eventsClosedAt ??= at;
        },
        async pendingInjections(id) {
            calls.push("pendingInjections");
            return injections
                .filter(i => i.runId === id && i.appliedRound === null)
                .map(({ id: iid, text }) => ({ id: iid, text }));
        },
    };
    return store;
}

const model: SimulationModel & { requests: ModelRequest[] } = {
    requests: [],
    async complete(request) {
        this.requests.push(request);
        const usage = { inputTokens: 100, outputTokens: 10 };
        if (request.purpose === "brief") {
            return {
                text: JSON.stringify({
                    brief: "Price drives churn [E1].",
                    openingPost: "Acme raises prices 20%.",
                    evidenceIds: ["E1"],
                }),
                usage,
            };
        }
        if (request.purpose === "cast") {
            const n = Number(/Return exactly (\d+) personas/.exec(request.prompt)?.[1] ?? 1);
            const personas = Array.from({ length: n }, (_, i) => ({
                name: `Member ${i}`,
                handle: `@member_${i}`,
                role: i % 2 ? "Bookkeeper" : "Founder",
                bio: "Runs a small firm.",
                interests: ["pricing"],
                stance: i % 3 === 0 ? -1 : 1,
                activity: 1,
                influence: 0.3,
                sourceIds: i === 0 ? [] : ["E1"],
                invented: i === 0,
                currentSolution: "Spreadsheets",
                budget: "tight",
                buyingRole: i % 2 ? "uses" : "decides",
                switchingCost: "medium",
                objection: "Prices only go one way.",
            }));
            return { text: JSON.stringify({ personas }), usage };
        }
        if (request.purpose === "decide") {
            const first = /^\[(p\d+)\]/m.exec(request.prompt)?.[1];
            return {
                text: JSON.stringify({
                    thought: "Hm.",
                    stance: 1,
                    convincedBy: first ?? null,
                    wouldPay: "maybe",
                    objection: null,
                    actions: first
                        ? [{ type: "like", postId: first, text: null, handle: null }]
                        : [],
                }),
                usage,
            };
        }
        return {
            text: JSON.stringify({
                headline: "Most people warmed to it.",
                summary: "After the opening post, likes piled up.",
                dynamics: [{ text: "The opening post drew likes.", postIds: ["p1"] }],
                turningPoints: [],
                factions: [{ stance: "supportive", label: "Fine with it", text: "Value matters." }],
                watchFor: ["Churn in February"],
            }),
            usage,
        };
    },
};

function ports(store: ScenarioStore, overrides: Partial<ScenarioRunPorts> = {}): ScenarioRunPorts {
    return {
        store,
        model,
        gatherEvidence: async () => EVIDENCE,
        creditsFor: usage => usage.inputTokens + usage.outputTokens,
        charge: async () => true,
        now: () => new Date("2026-10-17T12:00:00Z"),
        ...overrides,
    };
}

async function drive(p: ScenarioRunPorts, id = 1) {
    const outcomes = [];
    for (let i = 0; i < 20; i++) {
        const o = await advanceRun(p, id);
        outcomes.push(o.state);
        if (o.state !== "advanced") break;
    }
    return outcomes;
}

describe("advanceRun", () => {
    it("runs brief → cast → rounds → report, one unit per call, charging as it goes", async () => {
        const store = memoryStore(baseRun());
        const before = model.requests.length;
        const outcomes = await drive(ports(store));
        const requests = model.requests.slice(before);
        expect(outcomes).toEqual(["advanced", "advanced", "advanced", "advanced", "done"]);
        const run = store.runs.get(1)!;
        expect(run.status).toBe("done");
        expect(run.step).toBe(unitCount(2));
        expect(run.brief?.brief).toBe("Price drives churn [E1].");
        expect(run.world?.round).toBe(2);
        expect(run.world?.agents).toHaveLength(6);
        expect(run.world?.agents[0]?.persona).toMatchObject({
            grounding: "invented",
            sourceIds: [],
        });
        expect(run.world?.agents[1]?.persona).toMatchObject({
            grounding: "grounded",
            sourceIds: ["E1"],
            currentSolution: "Spreadsheets",
            budget: "tight",
            buyingRole: "uses",
            switchingCost: "medium",
            objection: "Prices only go one way.",
        });
        // Two of six start against, as a scenario's mix asks: no second cast call.
        expect(requests.filter(r => r.purpose === "cast")).toHaveLength(1);
        expect(requests.find(r => r.purpose === "cast")?.prompt).toContain(
            "Starting stances for these 6: 2 against (-1 or -2), 2 undecided (0), 2 in favour (1 or 2)."
        );
        expect(run.world?.rounds.at(-1)?.wouldPayCounts).toEqual([0, 6, 0]);
        expect(run.world?.posts[0]).toMatchObject({
            authorId: "narrator",
            text: "Acme raises prices 20%.",
        });
        expect(run.world?.brief).toBe("Price drives churn.");
        expect(run.report?.headline).toBe("Most people warmed to it.");
        expect(run.reception).toBeNull();
        expect(run.usage.calls).toBeGreaterThan(5);
        expect(run.usage.credits).toBe(run.usage.inputTokens + run.usage.outputTokens);
        expect(run.finishedAt).toEqual(new Date("2026-10-17T12:00:00Z"));
        expect(await advanceRun(ports(store), 1)).toEqual({ state: "done" });
    });

    it("never applies a unit twice when two workers race on the same step", async () => {
        const store = memoryStore(baseRun());
        const p = ports(store);
        const [a, b] = await Promise.all([advanceRun(p, 1), advanceRun(p, 1)]);
        expect([a.state, b.state].sort()).toEqual(["advanced", "skipped"]);
        expect(store.runs.get(1)!.step).toBe(1);
    });

    it("shows the run as running as soon as its first unit starts", async () => {
        const store = memoryStore(baseRun());
        let statusDuringGather = "";
        await advanceRun(
            ports(store, {
                gatherEvidence: async () => {
                    statusDuringGather = store.runs.get(1)!.status;
                    return EVIDENCE;
                },
            }),
            1
        );
        expect(statusDuringGather).toBe("running");
    });

    it("stops at the next unit once cancel is requested", async () => {
        const store = memoryStore(baseRun());
        const p = ports(store);
        await advanceRun(p, 1);
        store.runs.get(1)!.cancelRequestedAt = new Date();
        expect(await advanceRun(p, 1)).toEqual({ state: "cancelled" });
        expect(store.runs.get(1)!.status).toBe("cancelled");
    });

    it("applies an injected event in the next round and marks it with that round", async () => {
        const store = memoryStore(baseRun());
        const p = ports(store);
        await advanceRun(p, 1); // brief
        await advanceRun(p, 1); // cast
        await advanceRun(p, 1); // round 1
        store.injections.push({
            id: 9,
            runId: 1,
            text: "A rival halves its prices.",
            appliedRound: null,
        });
        model.requests.length = 0;
        await advanceRun(p, 1); // round 2
        const run = store.runs.get(1)!;
        expect(store.injections[0]!.appliedRound).toBe(2);
        expect(run.world?.posts.find(x => x.kind === "event")).toMatchObject({
            round: 2,
            text: "A rival halves its prices.",
        });
        expect(
            model.requests
                .filter(r => r.purpose === "decide")
                .every(r => r.prompt.includes("A rival halves its prices."))
        ).toBe(true);
    });

    it("closes the event window before the final round reads pending events", async () => {
        const store = memoryStore(baseRun());
        const p = ports(store);
        await advanceRun(p, 1); // brief
        await advanceRun(p, 1); // cast
        await advanceRun(p, 1); // round 1 of 2
        expect(store.runs.get(1)!.eventsClosedAt).toBeNull();
        expect(store.calls).toEqual(["pendingInjections"]);
        await advanceRun(p, 1); // round 2, the last
        expect(store.calls).toEqual(["pendingInjections", "closeEvents", "pendingInjections"]);
        expect(store.runs.get(1)!.eventsClosedAt).toEqual(new Date("2026-10-17T12:00:00Z"));
    });

    it("charges the report before storing it, and fails the run without a report when refused", async () => {
        const store = memoryStore(baseRun());
        const units: string[] = [];
        let refuseReport = true;
        const p = ports(store, {
            charge: async (_r, _c, unit) => {
                units.push(unit);
                return !(unit === "report" && refuseReport);
            },
        });
        for (let i = 0; i < 4; i++) await advanceRun(p, 1); // brief, cast, 2 rounds
        expect(await advanceRun(p, 1)).toEqual({ state: "failed" });
        const run = store.runs.get(1)!;
        expect(run).toMatchObject({
            status: "failed",
            report: null,
            error: "The workspace ran out of credits during this run.",
        });
        expect(units).toEqual(["brief", "cast", "round 1", "round 2", "report"]);
        refuseReport = false;
    });

    it("fails the run when the workspace runs out of credits, keeping the finished unit", async () => {
        const store = memoryStore(baseRun());
        const charged: number[] = [];
        expect(
            await advanceRun(
                ports(store, { charge: async (_r, credits) => (charged.push(credits), false) }),
                1
            )
        ).toEqual({ state: "failed" });
        const run = store.runs.get(1)!;
        expect(run).toMatchObject({
            status: "failed",
            step: 1,
            error: "The workspace ran out of credits during this run.",
        });
        expect(charged).toEqual([110]);
    });

    it("charges only the worker whose commit won a race", async () => {
        const store = memoryStore(baseRun());
        const charged: string[] = [];
        const p = ports(store, { charge: async (_r, _c, unit) => (charged.push(unit), true) });
        await Promise.all([advanceRun(p, 1), advanceRun(p, 1)]);
        expect(charged).toEqual(["brief"]);
    });

    it("tests a draft post: the brand posts first and the report carries its reception", async () => {
        const draft = {
            text: "We just shipped invoices in 30 currencies.",
            networks: ["linkedin"],
            brandName: "Acme",
            brandHandle: "@acme",
        };
        const store = memoryStore(
            baseRun({ kind: "post_test", draft, draftHash: hashDraft(draft.text), roundCount: 1 })
        );
        const cast = model.requests.length;
        await drive(ports(store));
        const run = store.runs.get(1)!;
        expect(run.world?.posts[0]).toMatchObject({
            authorId: "brand",
            kind: "seed",
            text: draft.text,
        });
        expect(run.world?.accounts.map(a => a.handle)).toEqual(["@acme", "@newswire"]);
        const castPrompt = model.requests.slice(cast).find(r => r.purpose === "cast")?.prompt;
        expect(castPrompt).toContain("people who would see Acme's post on linkedin");
        // A brand's own audience starts warmer than a scenario's.
        expect(castPrompt).toContain(
            "Starting stances for these 6: 1 against (-1 or -2), 3 undecided (0), 2 in favour (1 or 2)."
        );
        expect(run.reception).toMatchObject({
            postId: "p1",
            exposed: 6,
            engaged: 6,
            engagementRate: 1,
        });
    });

    it("casts again for the missing skeptics when a cast comes back too warm", async () => {
        const warm = (n: number, against: boolean, name: string) =>
            Array.from({ length: n }, (_, i) => ({
                name: `${name} ${i}`,
                handle: `@${name.toLowerCase()}_${i}`,
                role: "Founder",
                bio: "Runs a small firm.",
                interests: [],
                stance: against ? -2 : i === 0 ? 2 : 1,
                activity: 1,
                influence: 0.3,
                sourceIds: i === 1 ? [] : ["E1"],
                invented: i === 1,
                currentSolution: "nothing",
                budget: "none",
                buyingRole: "decides",
                switchingCost: "low",
                objection: "Why now?",
            }));
        const requests: ModelRequest[] = [];
        const castModel: SimulationModel = {
            async complete(request) {
                requests.push(request);
                if (request.purpose !== "cast") return model.complete(request);
                const n = Number(/Return exactly (\d+) personas/.exec(request.prompt)?.[1] ?? 1);
                const recast = request.prompt.includes(`${n} against (-1 or -2), 0 undecided`);
                return {
                    text: JSON.stringify({ personas: warm(n, recast, recast ? "Skeptic" : "Fan") }),
                    usage: { inputTokens: 100, outputTokens: 10 },
                };
            },
        };
        const logs: string[] = [];
        const store = memoryStore(baseRun());
        const p = ports(store, { model: castModel, log: message => logs.push(message) });
        await advanceRun(p, 1); // brief
        await advanceRun(p, 1); // cast
        const casts = requests.filter(r => r.purpose === "cast");
        expect(casts).toHaveLength(2);
        expect(casts[1]!.prompt).toContain("Return exactly 2 personas.");
        expect(casts[1]!.prompt).toContain("Handles already taken: @newswire, @fan_0");
        const agents = store.runs.get(1)!.world!.agents;
        expect(agents.map(a => a.persona.id)).toEqual(["a1", "a2", "a3", "a4", "a5", "a6"]);
        // The invented seat goes first, then the warmest fan.
        expect(agents.map(a => [a.persona.name, a.stance])).toEqual([
            ["Skeptic 1", -2],
            ["Skeptic 0", -2],
            ["Fan 2", 1],
            ["Fan 3", 1],
            ["Fan 4", 1],
            ["Fan 5", 1],
        ]);
        expect(logs).toContain("scenario cast recast for skeptics");
    });

    it("keeps a warm cast when the call for skeptics fails", async () => {
        let castCalls = 0;
        const flaky: SimulationModel = {
            async complete(request) {
                if (request.purpose === "cast" && ++castCalls > 1) throw new Error("timeout");
                const reply = await model.complete(request);
                if (request.purpose !== "cast") return reply;
                const parsed = JSON.parse(reply.text) as { personas: Array<{ stance: number }> };
                for (const person of parsed.personas) person.stance = 1;
                return { ...reply, text: JSON.stringify(parsed) };
            },
        };
        const logs: string[] = [];
        const store = memoryStore(baseRun());
        const p = ports(store, { model: flaky, log: message => logs.push(message) });
        await advanceRun(p, 1); // brief
        expect(await advanceRun(p, 1)).toEqual({ state: "advanced", step: 2 });
        expect(store.runs.get(1)!.world!.agents.every(a => a.stance === 1)).toBe(true);
        expect(logs).toContain("scenario cast recast failed; keeping the cast");
    });

    it("reports stage and rounds done from the step", () => {
        expect(stageOf({ status: "queued", step: 0, roundCount: 3 })).toBe("gathering");
        expect(stageOf({ status: "running", step: 1, roundCount: 3 })).toBe("casting");
        expect(stageOf({ status: "running", step: 4, roundCount: 3 })).toBe("simulating");
        expect(stageOf({ status: "running", step: 5, roundCount: 3 })).toBe("reporting");
        expect(roundsDone({ step: 4, roundCount: 3 })).toBe(2);
    });
});

describe("evidence", () => {
    it("numbers evidence, drops duplicates and keeps every source represented", () => {
        const drafts = [
            ...Array.from({ length: 10 }, (_, i) => ({
                kind: "document" as const,
                label: `Doc ${i}`,
                text: `text ${i}`,
                ref: { type: "document", id: String(i) },
                href: null,
            })),
            {
                kind: "prospect" as const,
                label: "Prospect",
                text: "A logistics firm.",
                ref: { type: "prospect", id: "p" },
                href: null,
            },
            {
                kind: "prospect" as const,
                label: "Prospect",
                text: "A logistics firm.",
                ref: { type: "prospect", id: "p" },
                href: null,
            },
        ];
        const out = buildEvidence(drafts, { max: 3 });
        expect(out.map(e => [e.id, e.kind])).toEqual([
            ["E1", "document"],
            ["E2", "prospect"],
            ["E3", "document"],
        ]);
    });
});

describe("post tests", () => {
    it("hashes the normalized draft", () => {
        expect(hashDraft(" Hello\r\nworld \n")).toBe(hashDraft("Hello\nworld"));
        expect(normalizeDraft(" a\r\nb ")).toBe("a\nb");
    });

    it("reads real engagement from the network's figure or impressions", () => {
        expect(actualEngagement(null)).toBeNull();
        expect(
            actualEngagement({
                impressions: null,
                reactions: 5,
                comments: 1,
                shares: 0,
                clicks: null,
                engagement: null,
            })
        ).toBeNull();
        expect(
            actualEngagement({
                impressions: 200,
                reactions: 5,
                comments: 3,
                shares: 2,
                clicks: null,
                engagement: null,
            })
        ).toBe(0.05);
        expect(
            actualEngagement({
                impressions: 200,
                reactions: 5,
                comments: 3,
                shares: 2,
                clicks: null,
                engagement: 0.08,
            })
        ).toBe(0.08);
    });

    it("withholds agreement until five tested posts have results", () => {
        const linked = (n: number) =>
            Array.from({ length: n }, (_, i) => ({
                runId: i + 1,
                brandPostId: `bp${i}`,
                platform: "linkedin",
                status: "published",
                body: `post ${i}`,
                publishedAt: new Date(`2026-10-0${i + 1}T00:00:00Z`),
                metrics: {
                    impressions: 100,
                    reactions: i * 2,
                    comments: 0,
                    shares: 0,
                    clicks: null,
                    engagement: null,
                },
                predicted: i / 10,
            }));
        const few = buildTrackRecord(linked(4));
        expect(few).toMatchObject({
            tested: 4,
            withResults: 4,
            minimum: 5,
            spearman: null,
            hits: 0,
            total: 0,
        });
        const enough = buildTrackRecord(linked(5));
        expect(enough.spearman).toBe(1);
        expect(enough.total).toBe(5);
        const unpublished = buildTrackRecord([{ ...linked(1)[0]!, status: "scheduled" }]);
        expect(unpublished.rows[0]!.actual).toBeNull();
    });
});
