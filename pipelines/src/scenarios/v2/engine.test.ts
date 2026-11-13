import { describe, expect, it } from "vitest";

import type { UnitRecord } from "./contracts";
import {
    AccessRevokedError,
    advanceWithFence,
    driveV2,
    nextReadyUnit,
    RUN_MESSAGES,
    stepV2,
    type EngineDeps,
} from "./engine";
import {
    CALL_CREDITS,
    countingProvider,
    fakePorts,
    fakeStages,
    makeSpec,
    memoryStore,
    type MemoryStore,
} from "./engine.fixtures";
import { buildInitialPlan, unitKeys } from "./plan";
import { RetryLaterError, type Stage } from "./stage";

function setup(
    options: {
        stages?: Parameters<typeof fakeStages>[0];
        enforced?: boolean;
        balance?: number;
    } = {}
) {
    const clock = { now: new Date("2026-11-13T10:00:00Z") };
    const store = memoryStore();
    store.ledger.enforced = options.enforced ?? false;
    store.ledger.balance.set(5n, options.balance ?? 0);
    const provider = countingProvider();
    const deps: EngineDeps = {
        store,
        model: provider,
        stages: fakeStages(options.stages),
        stagePorts: fakePorts(() => clock.now),
        authorize: async () => {},
        now: () => clock.now,
        leaseMs: 60_000,
        concurrency: 2,
    };
    const advance = (ms: number) => {
        clock.now = new Date(clock.now.getTime() + ms);
    };
    return { clock, store, provider, deps, advance };
}

const noSleep = async () => {};

function committedKeys(store: MemoryStore, runId: number) {
    return store.units.filter(u => u.runId === runId && u.status === "committed").map(u => u.key);
}

describe("v2 engine", () => {
    it("drives a passage-mode plan to done, settling every unit once", async () => {
        const { store, provider, deps } = setup();
        const spec = makeSpec();
        const run = store.seedRun(spec);

        const result = await driveV2(deps, run.id, { sleep: noSleep });

        expect(result.last).toEqual({ state: "done" });
        const plan = buildInitialPlan(spec);
        expect(committedKeys(store, run.id).sort()).toEqual(plan.map(u => u.key).sort());
        const final = store.runs.get(run.id)!;
        expect(final.status).toBe("done");
        expect(final.step).toBe(plan.length);
        expect(final.leaseOwner).toBeNull();
        // brief, cast:plan, cast:batch:01, two rounds, report.
        expect(provider.calls).toHaveLength(6);
        expect(final.usage.calls).toBe(6);
        expect(final.usage.credits).toBe(6 * CALL_CREDITS);
        expect(store.debits.map(d => d.description)).toEqual([
            'Scenario "Price rise" (brief)',
            'Scenario "Price rise" (cast)',
            'Scenario "Price rise" (cast)',
            'Scenario "Price rise" (round 1)',
            'Scenario "Price rise" (round 2)',
            'Scenario "Price rise" (report)',
        ]);
        // Every unit's hold closed; one settlement per unit key.
        const holds = [...store.reservations.values()].filter(r => r.runId === run.id);
        expect(holds.every(r => r.status === "settled")).toBe(true);
        expect(new Set(holds.map(r => r.unitKey)).size).toBe(plan.length);
    });

    it("waits for every unit a prefix dependency matches, and none when nothing matches", () => {
        const unit = (key: string, status: UnitRecord["status"], dependsOn: string[] = []) =>
            ({ key, status, dependsOn, seq: 0 }) as unknown as UnitRecord;
        const freeze = unit("graph:freeze", "pending", ["graph:prepare", "graph:ingest:*"]);
        const prepared = unit("graph:prepare", "committed");
        expect(nextReadyUnit([prepared, freeze])?.key).toBe("graph:freeze");
        expect(
            nextReadyUnit([
                prepared,
                unit("graph:ingest:01", "committed"),
                unit("graph:ingest:02", "pending", ["graph:prepare"]),
                { ...freeze, seq: 1 },
            ])?.key
        ).toBe("graph:ingest:02");
        // An exact dependency that is not in the plan never counts as met.
        expect(nextReadyUnit([unit("report", "pending", ["round:09"])])).toBeUndefined();
    });

    it("never lets a stale lease holder commit, settle or fail the run", async () => {
        let release!: () => void;
        const gate = new Promise<void>(resolve => (release = resolve));
        const brief: Stage = async ctx => {
            const reply = await ctx.model.complete({
                purpose: "brief",
                system: "test",
                prompt: "brief",
                maxOutputTokens: 100,
            });
            if (ctx.run.leaseOwner === "A") await gate;
            return { output: reply.text };
        };
        const { store, provider, deps, advance, clock } = setup({ stages: { brief } });
        const run = store.seedRun(makeSpec());
        // sources commits first under its own lease.
        await stepV2(deps, run.id);

        const fenceA = (await store.claimLease(
            run.id,
            "A",
            clock.now,
            new Date(clock.now.getTime() + 1_000)
        ))!;
        const a = advanceWithFence(deps, fenceA);
        await new Promise(r => setTimeout(r, 0));

        // A's lease lapses; B takes over with a higher epoch and runs the unit.
        advance(5_000);
        const fenceB = (await store.claimLease(
            run.id,
            "B",
            clock.now,
            new Date(clock.now.getTime() + 60_000)
        ))!;
        expect(fenceB.epoch).toBe(fenceA.epoch + 1);
        expect(await advanceWithFence(deps, fenceB)).toEqual({
            state: "advanced",
            unitKey: "brief",
        });
        // B's provider call was served from A's accepted reply.
        expect(provider.calls).toHaveLength(1);

        release();
        expect(await a).toEqual({ state: "skipped", reason: "fenced" });

        expect(store.debits.filter(d => d.description.includes("(brief)"))).toHaveLength(1);
        expect(store.unit(run.id, "brief").status).toBe("committed");
        // The stale fence can do nothing else either.
        expect(await store.finishRun(fenceA, { status: "failed", error: "x", at: clock.now })).toBe(
            false
        );
        expect(
            await store.reserve(fenceA, { companyId: 5n, unitKey: "cast:plan", amount: 1 })
        ).toBeNull();
        expect(await store.renewLease(fenceA, clock.now)).toBe(false);
        expect(store.runs.get(run.id)!.status).toBe("running");
    });

    it("reuses the journaled reply after a crash between the reply and the commit", async () => {
        const { store, provider, deps } = setup();
        const run = store.seedRun(makeSpec());
        await stepV2(deps, run.id); // sources

        let crash = true;
        store.hooks.beforeCommit = () => {
            if (crash) {
                crash = false;
                throw new Error("worker died");
            }
        };
        await expect(stepV2(deps, run.id)).rejects.toThrow("worker died");
        expect(provider.calls).toHaveLength(1);
        expect(store.unit(run.id, "brief").attempts).toBe(1);
        expect(store.debits).toHaveLength(0);

        expect(await stepV2(deps, run.id)).toEqual({ state: "advanced", unitKey: "brief" });
        // Zero new provider calls: the second attempt read the journal.
        expect(provider.calls).toHaveLength(1);
        const brief = store.unit(run.id, "brief");
        expect(brief.status).toBe("committed");
        expect(brief.usage).toEqual({ calls: 1, inputTokens: 100, outputTokens: 10 });
        expect(store.debits).toEqual([expect.objectContaining({ amount: CALL_CREDITS })]);
    });

    it("drops a unit's work when cancellation wins the commit guard", async () => {
        const { store, deps, clock } = setup({
            stages: {
                cast_plan: async ctx => {
                    await ctx.model.complete({
                        purpose: "cast",
                        system: "test",
                        prompt: "cast:plan",
                        maxOutputTokens: 100,
                    });
                    // The creator presses Stop while the unit is working.
                    store.requestCancel(ctx.run.id, clock.now);
                    return { output: "plan" };
                },
            },
        });
        const run = store.seedRun(makeSpec());
        await stepV2(deps, run.id); // sources
        await stepV2(deps, run.id); // brief

        expect(await stepV2(deps, run.id)).toEqual({ state: "cancelled" });

        const final = store.runs.get(run.id)!;
        expect(final.status).toBe("cancelled");
        expect(store.unit(run.id, unitKeys.castPlan).status).toBe("running");
        expect(store.reservation(run.id, unitKeys.castPlan)?.status).toBe("released");
        // The brief's charge stands; the cast plan was never charged.
        expect(store.debits.map(d => d.description)).toEqual(['Scenario "Price rise" (brief)']);
        expect(
            [...store.reservations.values()].filter(r => r.runId === run.id && r.status === "held")
        ).toHaveLength(0);
    });

    it("waits on RetryLaterError without counting an attempt, then gives up after maxWaitMs", async () => {
        let available = false;
        const { store, deps, advance, clock } = setup({
            stages: {
                brief: async ctx => {
                    if (!available) throw new RetryLaterError("graph down", 5_000);
                    const reply = await ctx.model.complete({
                        purpose: "brief",
                        system: "test",
                        prompt: "brief",
                        maxOutputTokens: 100,
                    });
                    return { output: reply.text };
                },
            },
        });
        const run = store.seedRun(makeSpec());
        await stepV2(deps, run.id); // sources
        const firstWait = clock.now.toISOString();

        const waiting = await stepV2(deps, run.id);
        expect(waiting).toEqual({
            state: "waiting",
            unitKey: "brief",
            retryAt: new Date(clock.now.getTime() + 5_000),
        });
        expect(store.unit(run.id, "brief")).toMatchObject({ status: "pending", attempts: 0 });
        const r = store.runs.get(run.id)!;
        expect(r.flags?.waitingSince).toBe(firstWait);
        expect(r.leaseOwner).toBeNull();

        // The backoff keeps everyone off the lease until it passes.
        expect(await stepV2(deps, run.id)).toEqual({ state: "skipped", reason: "leased" });
        advance(6_000);
        expect((await stepV2(deps, run.id)).state).toBe("waiting");
        expect(store.runs.get(run.id)!.flags?.waitingSince).toBe(firstWait);
        expect(store.unit(run.id, "brief").attempts).toBe(0);

        // Recovery clears the wait.
        available = true;
        advance(6_000);
        expect(await stepV2(deps, run.id)).toEqual({ state: "advanced", unitKey: "brief" });
        expect(store.runs.get(run.id)!.flags?.waitingSince).toBeNull();

        // A wait longer than maxWaitMs fails the run and lets the holds go.
        const second = setup({
            stages: {
                brief: async () => {
                    throw new RetryLaterError("graph down");
                },
            },
        });
        const run2 = second.store.seedRun(makeSpec());
        await stepV2(second.deps, run2.id);
        expect((await stepV2(second.deps, run2.id)).state).toBe("waiting");
        second.advance(31 * 60_000);
        expect(await stepV2(second.deps, run2.id)).toEqual({ state: "failed" });
        expect(second.store.runs.get(run2.id)!.error).toBe(RUN_MESSAGES.graphUnavailable);
        expect(second.store.reservation(run2.id, "brief")?.status).toBe("released");
    });

    it("fails the run and charges nothing when a unit's hold is refused", async () => {
        const spec = makeSpec();
        const plan = buildInitialPlan(spec);
        const brief = plan.find(u => u.key === "brief")!;
        const { store, provider, deps } = setup({ enforced: true, balance: brief.maxCredits });
        const run = store.seedRun(spec);
        await stepV2(deps, run.id); // sources
        await stepV2(deps, run.id); // brief settles one call
        // Another feature spends the rest meanwhile: the cast plan's hold no longer fits.
        store.ledger.balance.set(5n, 500);

        expect(await stepV2(deps, run.id)).toEqual({ state: "failed" });
        const final = store.runs.get(run.id)!;
        expect(final.error).toBe(RUN_MESSAGES.outOfCredits);
        expect(store.unit(run.id, unitKeys.castPlan).status).toBe("failed");
        // No provider call and no charge for the refused unit.
        expect(provider.calls.map(c => c.prompt)).toEqual(["brief"]);
        expect(store.debits.map(d => d.description)).toEqual(['Scenario "Price rise" (brief)']);
        expect(store.reservation(run.id, unitKeys.castPlan)).toBeUndefined();
    });

    it("fails the run after maxAttempts and releases its holds", async () => {
        const { store, deps } = setup({
            stages: {
                brief: async () => {
                    throw new Error("The model returned nothing usable");
                },
            },
        });
        const run = store.seedRun(makeSpec());
        await stepV2(deps, run.id); // sources

        await expect(stepV2(deps, run.id)).rejects.toThrow("nothing usable");
        await expect(stepV2(deps, run.id)).rejects.toThrow("nothing usable");
        expect(store.reservation(run.id, "brief")?.status).toBe("held");
        expect(await stepV2(deps, run.id)).toEqual({ state: "failed" });

        const final = store.runs.get(run.id)!;
        expect(final.status).toBe("failed");
        expect(final.error).toBe("The model returned nothing usable");
        expect(store.unit(run.id, "brief")).toMatchObject({ status: "failed", attempts: 3 });
        expect(store.reservation(run.id, "brief")?.status).toBe("released");
        expect(store.debits).toHaveLength(0);
        // The driver gives up on its own as well.
        const again = setup({
            stages: {
                brief: async () => {
                    throw new Error("boom");
                },
            },
        });
        const run2 = again.store.seedRun(makeSpec());
        expect((await driveV2(again.deps, run2.id, { sleep: noSleep })).last).toEqual({
            state: "failed",
        });
    });

    it("counts a lost reply as an unknown attempt and pays for the retry once", async () => {
        const { store, provider, deps } = setup();
        const run = store.seedRun(makeSpec());
        await stepV2(deps, run.id); // sources
        let first = true;
        provider.fail = () => {
            if (!first) return null;
            first = false;
            return Object.assign(new Error("Request timed out"), { name: "TimeoutError" });
        };
        await expect(stepV2(deps, run.id)).rejects.toThrow("timed out");
        expect(store.runs.get(run.id)!.flags?.unknownAttempts).toBe(1);
        expect(store.attempts.map(a => a.status)).toEqual(["unknown"]);

        expect((await stepV2(deps, run.id)).state).toBe("advanced");
        expect(store.attempts.map(a => a.status)).toEqual(["unknown", "succeeded"]);
        // Billed for the accepted attempt only; the lost one stays in the journal.
        expect(store.unit(run.id, "brief").usage.calls).toBe(1);
        expect(store.runs.get(run.id)!.flags?.unknownAttempts).toBe(1);
    });

    it("stops with a generic message when access is revoked", async () => {
        const { store, deps } = setup();
        deps.authorize = async () => {
            throw new AccessRevokedError("cannot read Board deck.pdf");
        };
        const run = store.seedRun(makeSpec());
        expect(await stepV2(deps, run.id)).toEqual({ state: "failed" });
        const final = store.runs.get(run.id)!;
        expect(final.error).toBe(RUN_MESSAGES.accessRevoked);
        expect(final.error).not.toContain("Board deck");
        expect([...store.reservations.values()].every(r => r.status === "released")).toBe(true);
    });

    it("refuses runs that are not v2 and stops at a terminal status", async () => {
        const { store, deps } = setup();
        const run = store.seedRun(makeSpec());
        store.runs.get(run.id)!.contractVersion = 1;
        expect(await stepV2(deps, run.id)).toEqual({ state: "skipped", reason: "not_v2" });
        store.runs.get(run.id)!.contractVersion = 2;
        store.runs.get(run.id)!.status = "done";
        expect(await stepV2(deps, run.id)).toEqual({ state: "done" });
        expect(await stepV2(deps, 999)).toEqual({ state: "skipped", reason: "missing" });
    });
});
