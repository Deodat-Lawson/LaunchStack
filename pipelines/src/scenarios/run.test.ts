import { describe, expect, it } from "vitest";

import type { ModelRequest, SimulationModel } from "@launchstack/simulation";

import { buildEvidence } from "./evidence";
import { actualEngagement, buildTrackRecord, hashDraft, normalizeDraft } from "./post-tests";
import { advanceRun, type RunPatch, type ScenarioRunPorts, type ScenarioStore } from "./run";
import type { ScenarioRunRecord, StoredEvidence } from "./types";
import { EMPTY_USAGE, roundsDone, stageOf, unitCount } from "./types";

const EVIDENCE: StoredEvidence[] = buildEvidence([
    { kind: "document", label: "Interviews.pdf", text: "Customers say price drives churn.", ref: { type: "document", id: "7" }, href: "/doc/7" },
    { kind: "brand_comment", label: "Comment on LinkedIn", text: "Renewal emails annoy me.", ref: { type: "brand_comment", id: "3" }, href: null },
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
        sources: { documentIds: [7], searchFiles: false, prospects: false, brandComments: true, companyProfile: false, notes: "" },
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
        ...overrides,
    };
}

function memoryStore(initial: ScenarioRunRecord) {
    const runs = new Map([[initial.id, structuredClone(initial)]]);
    const injections: Array<{ id: number; runId: number; text: string; appliedRound: number | null }> = [];
    const store: ScenarioStore & { runs: typeof runs; injections: typeof injections } = {
        runs,
        injections,
        async get(id) {
            const r = runs.get(id);
            return r ? structuredClone(r) : undefined;
        },
        async commitUnit(id, expected, patch: RunPatch, applied) {
            const r = runs.get(id);
            if (!r || r.step !== expected || !["queued", "running"].includes(r.status)) return false;
            Object.assign(r, patch, { step: expected + 1 });
            if (applied) for (const i of injections) if (applied.injectionIds.includes(i.id)) i.appliedRound = applied.round;
            return true;
        },
        async finish(id, status, error, at) {
            const r = runs.get(id)!;
            if (!["queued", "running"].includes(r.status)) return false;
            Object.assign(r, { status, error, finishedAt: at });
            return true;
        },
        async pendingInjections(id) {
            return injections.filter(i => i.runId === id && i.appliedRound === null).map(({ id: iid, text }) => ({ id: iid, text }));
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
            return { text: JSON.stringify({ brief: "Price drives churn [E1].", openingPost: "Acme raises prices 20%.", evidenceIds: ["E1"] }), usage };
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
            }));
            return { text: JSON.stringify({ personas }), usage };
        }
        if (request.purpose === "decide") {
            const first = /^\[(p\d+)\]/m.exec(request.prompt)?.[1];
            return {
                text: JSON.stringify({
                    thought: "Hm.",
                    stance: 1,
                    actions: first ? [{ type: "like", postId: first, text: null, handle: null }] : [],
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
        const outcomes = await drive(ports(store));
        expect(outcomes).toEqual(["advanced", "advanced", "advanced", "advanced", "done"]);
        const run = store.runs.get(1)!;
        expect(run.status).toBe("done");
        expect(run.step).toBe(unitCount(2));
        expect(run.brief?.brief).toBe("Price drives churn [E1].");
        expect(run.world?.round).toBe(2);
        expect(run.world?.agents).toHaveLength(6);
        expect(run.world?.agents[0]?.persona).toMatchObject({ grounding: "invented", sourceIds: [] });
        expect(run.world?.agents[1]?.persona).toMatchObject({ grounding: "grounded", sourceIds: ["E1"] });
        expect(run.world?.posts[0]).toMatchObject({ authorId: "narrator", text: "Acme raises prices 20%." });
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
        store.injections.push({ id: 9, runId: 1, text: "A rival halves its prices.", appliedRound: null });
        model.requests.length = 0;
        await advanceRun(p, 1); // round 2
        const run = store.runs.get(1)!;
        expect(store.injections[0]!.appliedRound).toBe(2);
        expect(run.world?.posts.find(x => x.kind === "event")).toMatchObject({ round: 2, text: "A rival halves its prices." });
        expect(model.requests.filter(r => r.purpose === "decide").every(r => r.prompt.includes("A rival halves its prices."))).toBe(true);
    });

    it("fails the run when the workspace runs out of credits, keeping the finished unit", async () => {
        const store = memoryStore(baseRun());
        const charged: number[] = [];
        expect(await advanceRun(ports(store, { charge: async (_r, credits) => (charged.push(credits), false) }), 1)).toEqual({ state: "failed" });
        const run = store.runs.get(1)!;
        expect(run).toMatchObject({ status: "failed", step: 1, error: "The workspace ran out of credits during this run." });
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
        const draft = { text: "We just shipped invoices in 30 currencies.", networks: ["linkedin"], brandName: "Acme", brandHandle: "@acme" };
        const store = memoryStore(baseRun({ kind: "post_test", draft, draftHash: hashDraft(draft.text), roundCount: 1 }));
        const cast = model.requests.length;
        await drive(ports(store));
        const run = store.runs.get(1)!;
        expect(run.world?.posts[0]).toMatchObject({ authorId: "brand", kind: "seed", text: draft.text });
        expect(run.world?.accounts.map(a => a.handle)).toEqual(["@acme", "@newswire"]);
        expect(model.requests.slice(cast).find(r => r.purpose === "cast")?.prompt).toContain("people who would see Acme's post on linkedin");
        expect(run.reception).toMatchObject({ postId: "p1", exposed: 6, engaged: 6, engagementRate: 1 });
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
            ...Array.from({ length: 10 }, (_, i) => ({ kind: "document" as const, label: `Doc ${i}`, text: `text ${i}`, ref: { type: "document", id: String(i) }, href: null })),
            { kind: "prospect" as const, label: "Prospect", text: "A logistics firm.", ref: { type: "prospect", id: "p" }, href: null },
            { kind: "prospect" as const, label: "Prospect", text: "A logistics firm.", ref: { type: "prospect", id: "p" }, href: null },
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
        expect(actualEngagement({ impressions: null, reactions: 5, comments: 1, shares: 0, clicks: null, engagement: null })).toBeNull();
        expect(actualEngagement({ impressions: 200, reactions: 5, comments: 3, shares: 2, clicks: null, engagement: null })).toBe(0.05);
        expect(actualEngagement({ impressions: 200, reactions: 5, comments: 3, shares: 2, clicks: null, engagement: 0.08 })).toBe(0.08);
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
                metrics: { impressions: 100, reactions: i * 2, comments: 0, shares: 0, clicks: null, engagement: null },
                predicted: i / 10,
            }));
        const few = buildTrackRecord(linked(4));
        expect(few).toMatchObject({ tested: 4, withResults: 4, minimum: 5, spearman: null, hits: 0, total: 0 });
        const enough = buildTrackRecord(linked(5));
        expect(enough.spearman).toBe(1);
        expect(enough.total).toBe(5);
        const unpublished = buildTrackRecord([{ ...linked(1)[0]!, status: "scheduled" }]);
        expect(unpublished.rows[0]!.actual).toBeNull();
    });
});
