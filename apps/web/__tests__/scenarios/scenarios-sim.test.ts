/**
 * The /dev/scenarios harness answers every `/api/scenarios/**` endpoint of
 * the wire contract from memory, and the Scenarios tab is verified against
 * it. These tests pin its rules — the seeded runs, a live run moving round by
 * round, creating, cancelling, events, interviews, the credit checks — so the
 * real routes can be held to the same behaviour.
 */
import {
    TIMING,
    configureScenariosSim,
    resetScenariosSim,
    simulateScenarios,
} from "~/app/dev/scenarios/scenarios-sim";
import {
    SCENARIO_LIMITS,
    type ScenarioDetail,
    type ScenarioEstimate,
    type ScenarioInjection,
    type ScenarioInterview,
    type ScenarioSourceOptions,
    type ScenarioSummary,
} from "~/lib/scenarios/types";

const T0 = Date.parse("2026-10-17T12:00:00Z");

async function call<T>(
    path: string,
    init?: RequestInit,
    now = T0
): Promise<{ status: number; body: T }> {
    const response = await simulateScenarios(new URL(path, "http://harness.local"), init, now);
    if (!response) throw new Error(`no answer for ${path}`);
    return { status: response.status, body: (await response.json()) as T };
}

const post = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });
const patch = (body: unknown): RequestInit => ({ method: "PATCH", body: JSON.stringify(body) });

const detail = async (id: number, now = T0) =>
    (await call<{ run: ScenarioDetail }>(`/api/scenarios/${id}`, undefined, now)).body.run;

const NO_SOURCES = {
    documentIds: [],
    searchFiles: false,
    prospects: false,
    brandComments: false,
    companyProfile: false,
    notes: "",
};

beforeEach(() => resetScenariosSim({}, T0));

describe("scenarios harness", () => {
    it("ignores anything outside /api/scenarios", async () => {
        expect(await simulateScenarios(new URL("http://x/api/brand/posts"))).toBeNull();
    });

    it("lists mine and shared runs, newest first, in every state", async () => {
        const { body } = await call<{ runs: ScenarioSummary[] }>("/api/scenarios");
        expect(body.runs.map(r => [r.id, r.status])).toEqual([
            [2, "running"],
            [1, "done"],
            [5, "done"],
            [3, "failed"],
            [4, "cancelled"],
        ]);
        const shared = body.runs.find(r => r.id === 5)!;
        expect(shared).toMatchObject({
            createdByMe: false,
            createdByName: "Dana Okafor",
            shared: true,
        });
        expect(body.runs.find(r => r.id === 1)!.headline).toMatch(/price hold/);
        expect(body.runs.every(r => r.kind === "scenario")).toBe(true);
    });

    it("starts empty with the empty switch", async () => {
        configureScenariosSim({ empty: true }, T0);
        const { body } = await call<{ runs: ScenarioSummary[] }>("/api/scenarios");
        expect(body.runs).toEqual([]);
    });

    it("the finished run has twelve people, eight rounds, a report and a redacted file", async () => {
        const run = await detail(1);
        expect(run.people).toHaveLength(12);
        expect(run.people.filter(p => p.grounding === "invented")).toHaveLength(4);
        expect(run.roundStats).toHaveLength(8);
        expect(run.rounds).toBe(8);
        for (const r of run.roundStats) {
            expect(r.stanceCounts.reduce((a, b) => a + b, 0)).toBe(12);
        }
        expect(run.report?.factions.reduce((n, f) => n + f.share, 0)).toBeCloseTo(1);
        // Every post a report points at is in the feed.
        const ids = new Set(run.posts.map(p => p.id));
        for (const d of [...run.report!.dynamics, ...run.report!.turningPoints]) {
            for (const id of d.postIds) expect(ids.has(id)).toBe(true);
        }
        const redacted = run.sources.find(s => s.redacted)!;
        expect(redacted).toMatchObject({ label: "", excerpt: null, href: null });
        expect(run.injections).toEqual([
            expect.objectContaining({
                round: 4,
                text: expect.stringMatching(/unlimited invoices/),
            }),
        ]);
        expect(run.posts.find(p => p.kind === "event")?.round).toBe(4);
        expect(run.canManage).toBe(true);
    });

    it("a live run finishes a round every few seconds as it is polled", async () => {
        const first = await detail(2);
        expect(first).toMatchObject({ status: "running", stage: "simulating", round: 2 });
        expect(first.roundStats).toHaveLength(2);
        expect(first.report).toBeNull();
        expect(first.posts.every(p => p.round <= 2)).toBe(true);
        expect(first.people.every(p => p.stanceHistory.length === 3)).toBe(true);

        const later = await detail(2, T0 + TIMING.round);
        expect(later.round).toBe(3);
        expect(later.usage.calls).toBeGreaterThan(first.usage.calls);

        const end = await detail(2, T0 + 60_000);
        expect(end).toMatchObject({ status: "done", stage: "done", round: 8 });
        expect(end.report?.headline).toBeTruthy();
        expect(end.finishedAt).not.toBeNull();
    });

    it("estimates calls and credits, and blocks a run the balance cannot cover", async () => {
        const { body } = await call<ScenarioEstimate>(
            "/api/scenarios/estimate",
            post({ agents: 30, rounds: 8 })
        );
        expect(body).toMatchObject({ agents: 30, rounds: 8, enough: true, balance: 1250 });
        expect(body.calls).toBeGreaterThan(30 * 8 * 0.5);
        const big = await call<ScenarioEstimate>(
            "/api/scenarios/estimate",
            post({ agents: 200, rounds: 30 })
        );
        expect(big.body.enough).toBe(false);
        const bad = await call("/api/scenarios/estimate", post({ agents: 2, rounds: 8 }));
        expect(bad.status).toBe(400);
    });

    it("offers the workspace's files and sources", async () => {
        const { body } = await call<ScenarioSourceOptions>("/api/scenarios/sources");
        expect(body.documents.length).toBeGreaterThan(5);
        expect(body).toMatchObject({ prospects: 42, brandComments: 18, companyProfile: true });
    });

    it("creating a run starts it, and it shows up in the list", async () => {
        const created = await call<{ run: ScenarioSummary }>(
            "/api/scenarios",
            post({
                subject: "We stop answering support email on weekends.",
                sources: { ...NO_SOURCES, documentIds: [212], companyProfile: true },
                agents: 10,
                rounds: 3,
            })
        );
        expect(created.status).toBe(201);
        expect(created.body.run).toMatchObject({ status: "queued", agents: 10, rounds: 3 });
        const id = created.body.run.id;
        const running = await detail(id, T0 + TIMING.gathering + TIMING.casting + 10);
        expect(running.stage).toBe("simulating");
        expect(running.people).toHaveLength(10);
        expect(running.sources[0]).toMatchObject({ kind: "document", redacted: false });
        const list = await call<{ runs: ScenarioSummary[] }>("/api/scenarios");
        expect(list.body.runs[0]!.id).toBe(id);
    });

    it("refuses an empty situation and out-of-range sizes with 400", async () => {
        const empty = await call<{ error: string }>(
            "/api/scenarios",
            post({ subject: " ", sources: NO_SOURCES, agents: 30, rounds: 8 })
        );
        expect(empty.status).toBe(400);
        expect(empty.body.error).toBeTruthy();
        const tooMany = await call(
            "/api/scenarios",
            post({
                subject: "x",
                sources: NO_SOURCES,
                agents: SCENARIO_LIMITS.agents.max + 1,
                rounds: 8,
            })
        );
        expect(tooMany.status).toBe(400);
    });

    it("answers 402 insufficient_credits when the balance is short or changed", async () => {
        configureScenariosSim({ credits: "short" }, T0);
        const short = await call<{ code: string }>(
            "/api/scenarios",
            post({ subject: "x", sources: NO_SOURCES, agents: 30, rounds: 8 })
        );
        expect(short.status).toBe(402);
        expect(short.body.code).toBe("insufficient_credits");

        configureScenariosSim({ credits: "race" }, T0);
        const estimate = await call<ScenarioEstimate>(
            "/api/scenarios/estimate",
            post({ agents: 5, rounds: 1 })
        );
        expect(estimate.body.enough).toBe(true);
        const race = await call<{ code: string }>(
            "/api/scenarios",
            post({ subject: "x", sources: NO_SOURCES, agents: 5, rounds: 1 })
        );
        expect(race.status).toBe(402);
    });

    it("events wait for the next round, then appear in the feed", async () => {
        const added = await call<{ injection: ScenarioInjection }>(
            "/api/scenarios/2/events",
            post({ text: "A competitor makes its free plan permanent." })
        );
        expect(added.status).toBe(201);
        expect(added.body.injection.round).toBeNull();
        const now = await detail(2);
        expect(now.injections.at(-1)?.round).toBeNull();
        const next = await detail(2, T0 + TIMING.round);
        expect(next.injections.at(-1)?.round).toBe(3);
        expect(next.posts.some(p => p.kind === "event" && p.round === 3)).toBe(true);

        const done = await call("/api/scenarios/1/events", post({ text: "Too late" }));
        expect(done.status).toBe(409);
    });

    it("cancels a live run where it stands; only the creator may", async () => {
        const cancelled = await call<{ run: ScenarioSummary }>("/api/scenarios/2/cancel", {
            method: "POST",
        });
        expect(cancelled.body.run).toMatchObject({ status: "cancelled", round: 2 });
        const later = await detail(2, T0 + 60_000);
        expect(later).toMatchObject({ status: "cancelled", round: 2, report: null });
        expect((await call("/api/scenarios/2/cancel", { method: "POST" })).status).toBe(409);
        expect((await call("/api/scenarios/5/cancel", { method: "POST" })).status).toBe(403);
    });

    it("renames, shares and deletes for the creator only", async () => {
        const renamed = await call<{ run: ScenarioSummary }>(
            "/api/scenarios/1",
            patch({ title: "January price rise", shared: true })
        );
        expect(renamed.body.run).toMatchObject({ title: "January price rise", shared: true });
        expect((await call("/api/scenarios/5", patch({ title: "Mine now" }))).status).toBe(403);
        expect((await call("/api/scenarios/1", { method: "DELETE" })).status).toBe(200);
        expect((await call("/api/scenarios/1")).status).toBe(404);
    });

    it("interviews answer people and the analyst, but not before round 1", async () => {
        const seeded = await call<{ interviews: ScenarioInterview[] }>(
            "/api/scenarios/1/interviews"
        );
        expect(seeded.body.interviews.map(i => i.agentId)).toEqual(["analyst", "a1"]);

        const asked = await call<{ interview: ScenarioInterview }>(
            "/api/scenarios/1/interviews",
            post({ agentId: "a2", question: "Why did you stay?" })
        );
        expect(asked.status).toBe(201);
        expect(asked.body.interview.answer.length).toBeGreaterThan(20);
        const analyst = await call<{ interview: ScenarioInterview }>(
            "/api/scenarios/1/interviews",
            post({ agentId: "analyst", question: "What mattered most?" })
        );
        expect(analyst.body.interview.answer).toMatch(/price hold/);
        expect(
            (await call("/api/scenarios/1/interviews", post({ agentId: "nobody", question: "?" })))
                .status
        ).toBe(404);

        const created = await call<{ run: ScenarioSummary }>(
            "/api/scenarios",
            post({ subject: "x", sources: NO_SOURCES, agents: 5, rounds: 2 })
        );
        const early = await call(
            `/api/scenarios/${created.body.run.id}/interviews`,
            post({ agentId: "analyst", question: "Too soon?" })
        );
        expect(early.status).toBe(409);
    });

    it("opens a Brand post test by its id as a finished post-test run", async () => {
        const run = await detail(501);
        expect(run).toMatchObject({ kind: "post_test", status: "done", agents: 20, rounds: 3 });
        expect(run.reception?.exposed).toBe(20);
        expect(run.draft?.text).toBeTruthy();
        expect(run.posts[0]).toMatchObject({ authorKind: "brand", kind: "seed" });
    });
});
