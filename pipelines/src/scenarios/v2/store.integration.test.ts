/**
 * The v2 store against a real Postgres: acceptance, idempotency, fenced
 * leases under competing workers, settlement, cancellation and the
 * reconciler's queries. Gated on TEST_DATABASE_URL (a local server whose role
 * may CREATE DATABASE, e.g. the retrieval-test-pg container on :5434). Each
 * run creates a throwaway database, applies the engine set and then the
 * product set with the real migration runner, and drops it afterwards.
 *
 * The ledger here is a small SQL stand-in over the app's token tables; the
 * app's own ledger is exercised by apps/web/__tests__/scenarios/v2-credits.
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { configureDatabase, createDb, type Db } from "@launchstack/store/client";

import { createScenarioCredits, heldCredits, type ScenarioLedger } from "./credits";
import { EMPTY_FLAGS, type GraphBuildState } from "./contracts";
import {
    advanceWithFence,
    driveV2,
    stepV2,
    type EngineDeps,
    type UnitCommit,
    type V2Store,
} from "./engine";
import { CALL_CREDITS, countingProvider, fakePorts, fakeStages, makeSpec } from "./engine.fixtures";
import { buildInitialPlan } from "./plan";
import type { Stage } from "./stage";
import {
    acceptRun,
    claimDueDispatches,
    claimDispatch,
    createV2Store,
    IdempotencyConflictError,
    InsufficientCreditsError,
    listRunUnits,
    markAbandonedAttempts,
    markDispatchSent,
    purgeRawReplies,
    redispatchStalledRuns,
    releaseTerminalHolds,
    type AcceptRunInput,
    buildsWithDeletedSources,
    markGraphBuildDeleted,
} from "./store";

const url = process.env.TEST_DATABASE_URL;
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..", "..", "..");
const LOCAL = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

function sqlLedger(db: Db["db"], mode: { enforced: boolean }): ScenarioLedger {
    return {
        enforced: () => mode.enforced,
        async lockBalance(tx, companyId) {
            const rows = await tx.execute<{ balance_tokens: number }>(sql`
                SELECT balance_tokens FROM pdr_ai_v2_token_accounts
                WHERE company_id = ${companyId.toString()}::bigint FOR UPDATE`);
            return Number([...rows][0]?.balance_tokens ?? 0);
        },
        async debit(tx, input) {
            await tx.execute(sql`
                UPDATE pdr_ai_v2_token_accounts
                SET balance_tokens = balance_tokens - ${input.amount}::int,
                    lifetime_tokens_used = lifetime_tokens_used + ${input.amount}::int
                WHERE company_id = ${input.companyId.toString()}::bigint`);
            await tx.execute(sql`
                INSERT INTO pdr_ai_v2_token_transactions
                    (company_id, type, amount, balance_after, description, service, reference_id, metadata)
                SELECT company_id, 'debit', ${-input.amount}::int, balance_tokens, ${input.description},
                       'scenario_simulation', ${input.referenceId}, ${JSON.stringify(input.metadata)}::jsonb
                FROM pdr_ai_v2_token_accounts WHERE company_id = ${input.companyId.toString()}::bigint`);
        },
    };
}

describe.skipIf(!url)("scenario v2 store (Postgres)", () => {
    let maintenance: Db;
    let databaseName: string;
    let handle: Db;
    const mode = { enforced: false };
    let store: V2Store;
    let credits: ReturnType<typeof createScenarioCredits>;
    let companyId: bigint;

    const run = <T extends Record<string, unknown>>(query: ReturnType<typeof sql>) =>
        handle.db.execute<T>(query).then(rows => [...rows]);

    const setBalance = (n: number) =>
        handle.db.execute(sql`
            UPDATE pdr_ai_v2_token_accounts SET balance_tokens = ${n}::int
            WHERE company_id = ${companyId.toString()}::bigint`);

    const balance = async () =>
        Number(
            (
                await run<{ b: number }>(sql`
                    SELECT balance_tokens AS b FROM pdr_ai_v2_token_accounts
                    WHERE company_id = ${companyId.toString()}::bigint`)
            )[0]!.b
        );

    const debitsFor = (runId: number) =>
        run<{ amount: number; description: string; metadata: Record<string, unknown> }>(sql`
            SELECT amount, description, metadata FROM pdr_ai_v2_token_transactions
            WHERE company_id = ${companyId.toString()}::bigint
              AND metadata ->> 'runId' = ${String(runId)}
            ORDER BY id`);

    const reservationsFor = (runId: number) =>
        run<{ unit_key: string; status: string; reserved: number; settled: number | null }>(sql`
            SELECT unit_key, status, reserved, settled FROM pdr_ai_v2_scenario_credit_reservations
            WHERE run_id = ${runId} ORDER BY id`);

    const expireLease = (runId: number) =>
        handle.db.execute(sql`
            UPDATE pdr_ai_v2_scenario_runs SET lease_until = now() - interval '1 minute'
            WHERE id = ${runId}`);

    const input = (overrides: Partial<AcceptRunInput> = {}): AcceptRunInput => ({
        companyId,
        createdByUserId: "user-1",
        idempotencyKey: randomUUID(),
        payloadHash: "a".repeat(64),
        spec: makeSpec(),
        estimate: { calls: 6, inputTokens: 600, outputTokens: 60, credits: 6 * CALL_CREDITS },
        flags: { ...EMPTY_FLAGS },
        ...overrides,
    });

    const deps = (
        stages: Parameters<typeof fakeStages>[0] = {},
        provider = countingProvider()
    ): EngineDeps & { provider: ReturnType<typeof countingProvider> } => ({
        store,
        model: provider,
        provider,
        stages: fakeStages(stages),
        stagePorts: fakePorts(() => new Date()),
        authorize: async () => {},
        now: () => new Date(),
        leaseMs: 30_000,
        concurrency: 2,
    });

    /** Claim the lease and start the run's next unit by hand, for commit races. */
    async function startNextUnit(runId: number, owner = `t:${randomUUID()}`) {
        const now = new Date();
        const fence = (await store.claimLease(
            runId,
            owner,
            now,
            new Date(now.getTime() + 60_000)
        ))!;
        const units = await store.listUnits(runId, 1);
        const unit = units.find(u => u.status === "pending" || u.status === "running")!;
        const hold = await store.reserve(fence, {
            companyId,
            unitKey: unit.key,
            amount: unit.maxCredits,
        });
        expect(hold?.ok).toBe(true);
        const started = (await store.markUnitStarted(fence, unit.id, "h", now))!;
        const commit: UnitCommit = {
            unit: started,
            result: { output: { ok: true } },
            usage: { calls: 1, inputTokens: 100, outputTokens: 10 },
            credits: CALL_CREDITS,
            durationMs: 5,
            at: new Date(),
            settlement: { description: `Scenario "Price rise" (${unit.key})` },
        };
        return { fence, unit: started, commit };
    }

    beforeAll(async () => {
        const host = new URL(url!).hostname;
        if (!LOCAL.has(host) && process.env.LAUNCHSTACK_ALLOW_NON_LOCAL_TEST_DATABASE !== "1")
            throw new Error(`Refusing to create test databases on non-local host ${host}`);
        databaseName = `scn_v2_${randomUUID().replace(/-/g, "")}`;
        // The store's own client factory (pipelines has no direct postgres dependency).
        maintenance = createDb({ url: url!, maxConnections: 1 });
        await maintenance.client.unsafe(`CREATE DATABASE "${databaseName}"`);
        const testUrl = new URL(url!);
        testUrl.pathname = `/${databaseName}`;
        const env = { ...process.env, MIGRATE_DATABASE_URL: testUrl.toString() };
        const migrate = join(REPO, "packages", "store", "scripts", "migrate.mjs");
        execFileSync("node", [migrate], { cwd: REPO, env, stdio: "pipe" });
        execFileSync("node", [migrate, "--set=product"], { cwd: REPO, env, stdio: "pipe" });

        handle = createDb({ url: testUrl.toString(), maxConnections: 12 });
        configureDatabase(handle.db);
        credits = createScenarioCredits(sqlLedger(handle.db, mode));
        store = createV2Store({ credits, db: handle.db });
        const [company] = await handle.client`
            INSERT INTO pdr_ai_v2_company (name, "numberOfEmployees")
            VALUES ('scenario-v2-test', '1') RETURNING id`;
        companyId = BigInt(company!.id as string);
        await handle.client`
            INSERT INTO pdr_ai_v2_token_accounts (company_id, balance_tokens)
            VALUES (${companyId.toString()}, 1000000)`;
    }, 240_000);

    afterAll(async () => {
        await handle?.close();
        if (maintenance) {
            await maintenance.client.unsafe(
                `DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`
            );
            await maintenance.close();
        }
    });

    it("accepts a run atomically, and the reconciler delivers a dispatch nobody published", async () => {
        mode.enforced = true;
        await setBalance(1_000_000);
        const accepted = await acceptRun(input(), credits, handle.db);
        expect(accepted.created).toBe(true);
        const r = accepted.run;
        expect(r).toMatchObject({
            contractVersion: 2,
            kind: "scenario",
            status: "queued",
            requestSpecId: accepted.requestSpecId,
            contextMode: "passage",
            generation: 1,
        });
        expect(r.usage).toEqual({ calls: 0, inputTokens: 0, outputTokens: 0, credits: 0 });
        const units = await listRunUnits(r.id, 1, handle.db);
        expect(units.map(u => u.key)).toEqual(buildInitialPlan(makeSpec()).map(u => u.key));
        const brief = units.find(u => u.key === "brief")!;
        expect(await reservationsFor(r.id)).toEqual([
            { unit_key: "brief", status: "held", reserved: brief.maxCredits, settled: null },
        ]);
        // A hold is not a ledger entry: the balance and the transactions are untouched.
        expect(await balance()).toBe(1_000_000);
        expect(await debitsFor(r.id)).toEqual([]);
        expect(accepted.dispatch).toMatchObject({
            eventId: `scenario-run:${r.id}:g1`,
            status: "pending",
        });

        // The web process died after commit, before publishing: the reconciler sends it.
        const claimed = await claimDueDispatches({ now: new Date() }, handle.db);
        expect(claimed.map(d => d.eventId)).toContain(`scenario-run:${r.id}:g1`);
        // Claimed rows are invisible to a second reconciler until sent or due again.
        expect(
            (await claimDueDispatches({ now: new Date() }, handle.db)).map(d => d.runId)
        ).not.toContain(r.id);
        expect(
            await claimDispatch(accepted.dispatch.id, { now: new Date() }, handle.db)
        ).toBeNull();
        await markDispatchSent(accepted.dispatch.id, new Date(), handle.db);
        const [row] = await run<{ status: string; attempts: number }>(sql`
            SELECT status, attempts FROM pdr_ai_v2_scenario_dispatches WHERE id = ${accepted.dispatch.id}`);
        expect(row).toEqual({ status: "sent", attempts: 1 });

        // A refused hold rolls everything back.
        await setBalance(10);
        const before = await run<{ n: number }>(sql`
            SELECT (SELECT count(*) FROM pdr_ai_v2_scenario_runs)::int
                 + (SELECT count(*) FROM pdr_ai_v2_scenario_request_specs)::int
                 + (SELECT count(*) FROM pdr_ai_v2_scenario_units)::int
                 + (SELECT count(*) FROM pdr_ai_v2_scenario_dispatches)::int AS n`);
        const refused = await acceptRun(input(), credits, handle.db).catch(e => e);
        expect(refused).toBeInstanceOf(InsufficientCreditsError);
        expect((refused as InsufficientCreditsError).required).toBe(brief.maxCredits);
        const afterCount = await run<{ n: number }>(sql`
            SELECT (SELECT count(*) FROM pdr_ai_v2_scenario_runs)::int
                 + (SELECT count(*) FROM pdr_ai_v2_scenario_request_specs)::int
                 + (SELECT count(*) FROM pdr_ai_v2_scenario_units)::int
                 + (SELECT count(*) FROM pdr_ai_v2_scenario_dispatches)::int AS n`);
        expect(afterCount[0]!.n).toBe(before[0]!.n);
        mode.enforced = false;
        await setBalance(1_000_000);
    });

    it("returns the original run for a repeated Idempotency-Key and refuses a different payload", async () => {
        const key = randomUUID();
        const first = await acceptRun(input({ idempotencyKey: key }), credits, handle.db);
        const again = await acceptRun(input({ idempotencyKey: key }), credits, handle.db);
        expect(again.created).toBe(false);
        expect(again.run.id).toBe(first.run.id);
        expect(again.dispatch.id).toBe(first.dispatch.id);
        await expect(
            acceptRun(
                input({ idempotencyKey: key, payloadHash: "b".repeat(64) }),
                credits,
                handle.db
            )
        ).rejects.toBeInstanceOf(IdempotencyConflictError);

        // Concurrent requests with one key converge on one run.
        const raced = randomUUID();
        const results = await Promise.all(
            Array.from({ length: 5 }, () =>
                acceptRun(input({ idempotencyKey: raced }), credits, handle.db)
            )
        );
        expect(new Set(results.map(x => x.run.id)).size).toBe(1);
        expect(results.filter(x => x.created)).toHaveLength(1);
        // No key: every request is its own run.
        const a = await acceptRun(input({ idempotencyKey: null }), credits, handle.db);
        const b = await acceptRun(input({ idempotencyKey: null }), credits, handle.db);
        expect(a.run.id).not.toBe(b.run.id);
    });

    it("lets competing workers converge: each unit commits and settles once", async () => {
        const accepted = await acceptRun(input(), credits, handle.db);
        const provider = countingProvider({ delayMs: 3 });
        const workers = [deps({}, provider), deps({}, provider), deps({}, provider)];
        // Three deliveries of the same run, each stepping until it stops.
        const loop = async (d: EngineDeps) => {
            for (let i = 0; i < 60; i++) {
                const outcome = await stepV2(d, accepted.run.id);
                if (["done", "failed", "cancelled"].includes(outcome.state)) return outcome.state;
                if (outcome.state === "skipped") await sleep(3);
            }
            return "gave up";
        };
        const states = await Promise.all(workers.map(loop));
        expect(states.every(s => s === "done")).toBe(true);

        const units = await listRunUnits(accepted.run.id, 1, handle.db);
        expect(units.every(u => u.status === "committed")).toBe(true);
        const holds = await reservationsFor(accepted.run.id);
        expect(holds).toHaveLength(units.length);
        expect(holds.every(h => h.status === "settled")).toBe(true);
        const debits = await debitsFor(accepted.run.id);
        expect(debits).toHaveLength(6);
        expect(provider.calls).toHaveLength(6);
        const final = (await store.getRun(accepted.run.id))!;
        expect(final.status).toBe("done");
        expect(final.step).toBe(units.length);
        expect(final.usage.credits).toBe(-debits.reduce((s, d) => s + d.amount, 0));
        expect(final.leaseOwner).toBeNull();
    });

    it("hands an expired lease to the next worker; the stale one cannot commit", async () => {
        const accepted = await acceptRun(input(), credits, handle.db);
        let release!: () => void;
        const gate = new Promise<void>(resolve => (release = resolve));
        const brief: Stage = async ctx => {
            const reply = await ctx.model.complete({
                purpose: "brief",
                system: "s",
                prompt: "brief",
                maxOutputTokens: 50,
            });
            if (ctx.run.leaseOwner?.startsWith("stale:")) await gate;
            return { output: reply.text };
        };
        const d = deps({ brief });
        await stepV2(d, accepted.run.id); // sources

        const now = new Date();
        const stale = (await store.claimLease(
            accepted.run.id,
            "stale:1",
            now,
            new Date(now.getTime() + 60_000)
        ))!;
        const pending = advanceWithFence(d, stale);
        // Let the stale worker reach its gate (its provider call is journaled by then).
        for (let i = 0; i < 100 && d.provider.calls.length === 0; i++) await sleep(10);
        await sleep(30);
        await expireLease(accepted.run.id);

        expect(await stepV2(d, accepted.run.id)).toEqual({ state: "advanced", unitKey: "brief" });
        release();
        expect(await pending).toEqual({ state: "skipped", reason: "fenced" });

        expect(d.provider.calls).toHaveLength(1);
        const briefDebits = (await debitsFor(accepted.run.id)).filter(x =>
            x.description.includes("(brief)")
        );
        expect(briefDebits).toHaveLength(1);
        expect(
            await store.finishRun(stale, { status: "failed", error: "stale", at: new Date() })
        ).toBe(false);
        expect((await store.getRun(accepted.run.id))!.status).toBe("running");
    });

    it("converges when the same dispatch is delivered twice, and re-dispatches a stalled run", async () => {
        const accepted = await acceptRun(input(), credits, handle.db);
        const provider = countingProvider({ delayMs: 2 });
        const [a, b] = await Promise.all([
            driveV2(deps({}, provider), accepted.run.id, { sleep }),
            driveV2(deps({}, provider), accepted.run.id, { sleep }),
        ]);
        // One driver held the lease for the whole run; the other found it taken (or finished).
        expect([a.last.state, b.last.state]).toContain("done");
        expect(a.units + b.units).toBe(buildInitialPlan(makeSpec()).length - 1);
        expect(provider.calls).toHaveLength(6);
        expect(await debitsFor(accepted.run.id)).toHaveLength(6);

        // A stalled run: lease lapsed, nothing pending, untouched for the grace period.
        const stalled = await acceptRun(input(), credits, handle.db);
        await markDispatchSent(stalled.dispatch.id, new Date(Date.now() - 3_600_000), handle.db);
        await handle.db.execute(sql`
            UPDATE pdr_ai_v2_scenario_runs SET updated_at = now() - interval '10 minutes'
            WHERE id = ${stalled.run.id}`);
        const first = await redispatchStalledRuns({ now: new Date() }, handle.db);
        expect(first.dispatched.map(x => x.eventId)).toContain(
            `scenario-run:${stalled.run.id}:g1:r1`
        );
        const second = await redispatchStalledRuns({ now: new Date() }, handle.db);
        expect(second.dispatched.map(x => x.runId)).not.toContain(stalled.run.id);
    });

    it("settles once under duplicate commits and after a crash that followed a commit", async () => {
        const accepted = await acceptRun(input(), credits, handle.db);
        const d = deps();
        await stepV2(d, accepted.run.id); // sources (no credits)

        const { fence, commit } = await startNextUnit(accepted.run.id);
        const results = await Promise.all([
            store.commitUnit(fence, commit),
            store.commitUnit(fence, commit),
        ]);
        expect(results.filter(Boolean)).toHaveLength(1);
        expect(await store.commitUnit(fence, commit)).toBe(false);
        expect(await debitsFor(accepted.run.id)).toHaveLength(1);

        // The worker dies right after that commit, still holding its lease.
        await expireLease(accepted.run.id);
        expect(await stepV2(d, accepted.run.id)).toEqual({
            state: "advanced",
            unitKey: "cast:plan",
        });
        const units = await listRunUnits(accepted.run.id, 1, handle.db);
        expect(units.find(u => u.key === "brief")!.status).toBe("committed");
        // The brief was not run again: only the cast plan called the provider.
        expect(d.provider.calls.map(c => c.prompt)).toEqual(["cast:plan"]);
        expect(
            (await debitsFor(accepted.run.id)).filter(x => x.description.includes("(brief)"))
        ).toHaveLength(1);
    });

    it("charges what a unit used and lets the rest of its hold go", async () => {
        mode.enforced = true;
        await setBalance(1_000_000);
        const accepted = await acceptRun(input(), credits, handle.db);
        const brief = (await listRunUnits(accepted.run.id, 1, handle.db)).find(
            u => u.key === "brief"
        )!;
        const heldBefore = await heldCredits(handle.db, companyId);
        expect(heldBefore).toBeGreaterThanOrEqual(brief.maxCredits);

        const d = deps();
        await stepV2(d, accepted.run.id); // sources
        await stepV2(d, accepted.run.id); // brief
        const holds = await reservationsFor(accepted.run.id);
        expect(holds.find(h => h.unit_key === "brief")).toEqual({
            unit_key: "brief",
            status: "settled",
            reserved: brief.maxCredits,
            settled: CALL_CREDITS,
        });
        expect(await heldCredits(handle.db, companyId)).toBe(heldBefore - brief.maxCredits);
        expect(await balance()).toBe(1_000_000 - CALL_CREDITS);
        const [debit] = await debitsFor(accepted.run.id);
        expect(debit).toMatchObject({
            amount: -CALL_CREDITS,
            description: 'Scenario "Price rise" (brief)',
        });
        expect(debit!.metadata).toMatchObject({ unitKey: "brief", reserved: brief.maxCredits });

        // A failing run lets every remaining hold go.
        const { fence } = await startNextUnit(accepted.run.id);
        expect(await store.finishRun(fence, { status: "failed", error: "x", at: new Date() })).toBe(
            true
        );
        expect(
            (await reservationsFor(accepted.run.id)).filter(h => h.status === "held")
        ).toHaveLength(0);

        // A hold left behind on a finished run (its worker died mid-release) is swept.
        const orphan = await acceptRun(input(), credits, handle.db);
        await handle.db.execute(sql`
            UPDATE pdr_ai_v2_scenario_runs SET status = 'failed' WHERE id = ${orphan.run.id}`);
        expect(await releaseTerminalHolds(new Date(), handle.db)).toBeGreaterThanOrEqual(1);
        expect((await reservationsFor(orphan.run.id))[0]!.status).toBe("released");
        mode.enforced = false;
    });

    it("keeps fail and commit consistent when they race", async () => {
        for (let i = 0; i < 8; i++) {
            const accepted = await acceptRun(input(), credits, handle.db);
            await stepV2(deps(), accepted.run.id); // sources
            const { fence, commit } = await startNextUnit(accepted.run.id);
            const [committed, failed] = await Promise.all([
                store.commitUnit(fence, commit),
                store.finishRun(fence, { status: "failed", error: "race", at: new Date() }),
            ]);
            expect(failed).toBe(true);
            const holds = await reservationsFor(accepted.run.id);
            const brief = holds.find(h => h.unit_key === "brief")!;
            const debits = await debitsFor(accepted.run.id);
            const unit = (await listRunUnits(accepted.run.id, 1, handle.db)).find(
                u => u.key === "brief"
            )!;
            if (committed) {
                expect(unit.status).toBe("committed");
                expect(brief.status).toBe("settled");
                expect(debits).toHaveLength(1);
            } else {
                expect(unit.status).not.toBe("committed");
                expect(brief.status).toBe("released");
                expect(debits).toHaveLength(0);
            }
            expect((await store.getRun(accepted.run.id))!.status).toBe("failed");
        }
    });

    it("lets a cancel that wins the commit guard drop the unit, keeping earlier charges", async () => {
        const accepted = await acceptRun(input(), credits, handle.db);
        const castPlan: Stage = async ctx => {
            await ctx.model.complete({
                purpose: "cast",
                system: "s",
                prompt: "cast:plan",
                maxOutputTokens: 50,
            });
            await handle.db.execute(sql`
                UPDATE pdr_ai_v2_scenario_runs SET cancel_requested_at = now() WHERE id = ${ctx.run.id}`);
            return { output: "plan" };
        };
        const d = deps({ cast_plan: castPlan });
        await stepV2(d, accepted.run.id); // sources
        await stepV2(d, accepted.run.id); // brief
        expect(await stepV2(d, accepted.run.id)).toEqual({ state: "cancelled" });

        const final = (await store.getRun(accepted.run.id))!;
        expect(final.status).toBe("cancelled");
        const holds = await reservationsFor(accepted.run.id);
        expect(holds.find(h => h.unit_key === "cast:plan")!.status).toBe("released");
        expect((await debitsFor(accepted.run.id)).map(x => x.description)).toEqual([
            'Scenario "Price rise" (brief)',
        ]);
        // The provider's work is still on record as expense.
        const [attempts] = await run<{ n: number }>(sql`
            SELECT count(*)::int AS n FROM pdr_ai_v2_scenario_call_attempts a
            JOIN pdr_ai_v2_scenario_calls c ON c.id = a.call_id
            WHERE c.run_id = ${accepted.run.id} AND a.status = 'succeeded'`);
        expect(attempts!.n).toBe(2);

        // Cancel racing a commit: either the commit lands first or nothing does.
        for (let i = 0; i < 6; i++) {
            const r = await acceptRun(input(), credits, handle.db);
            await stepV2(deps(), r.run.id);
            const { fence, commit } = await startNextUnit(r.run.id);
            const [committed] = await Promise.all([
                store.commitUnit(fence, commit),
                handle.db.execute(sql`
                    UPDATE pdr_ai_v2_scenario_runs SET cancel_requested_at = now() WHERE id = ${r.run.id}`),
            ]);
            await store.releaseLease(fence, null);
            const debits = await debitsFor(r.run.id);
            expect(debits).toHaveLength(committed ? 1 : 0);
            expect(await stepV2(deps(), r.run.id)).toEqual({ state: "cancelled" });
            const brief = (await reservationsFor(r.run.id)).find(h => h.unit_key === "brief")!;
            expect(brief.status).toBe(committed ? "settled" : "released");
        }
    });

    it("guards company graph builds: insert, owner updates, takeover only from a finished owner", async () => {
        const owner = await acceptRun(input(), credits, handle.db);
        const other = await acceptRun(input(), credits, handle.db);
        const build = {
            type: "graph_build" as const,
            buildKey: `bk-${randomUUID()}`.slice(0, 64),
            groupId: `g-${randomUUID()}`,
            manifestHash: "m".repeat(64),
            ontologyHash: "o".repeat(64),
            policyVersion: "graphiti-extract@1",
            state: "preparing" as GraphBuildState,
        };
        await stepV2(deps(), owner.run.id);
        await stepV2(deps(), other.run.id);
        const withWrite = async (runId: number, write: typeof build & { takeOver?: boolean }) => {
            const { fence, commit } = await startNextUnit(runId);
            const ok = await store.commitUnit(fence, {
                ...commit,
                result: { output: null, writes: [write] },
            });
            await store.releaseLease(fence, null);
            return ok;
        };
        expect(await withWrite(owner.run.id, build)).toBe(true);
        expect(await withWrite(other.run.id, { ...build, state: "ingesting" })).toBe(false);
        expect(
            await withWrite(other.run.id, {
                ...build,
                groupId: `g-${randomUUID()}`,
                takeOver: true,
            })
        ).toBe(false);
        await handle.db.execute(sql`
            UPDATE pdr_ai_v2_scenario_runs SET status = 'failed' WHERE id = ${owner.run.id}`);
        expect(
            await withWrite(other.run.id, {
                ...build,
                groupId: `g-${randomUUID()}`,
                takeOver: true,
            })
        ).toBe(true);
        const [row] = await run<{ owner_run_id: number; owner_epoch: number }>(sql`
            SELECT owner_run_id, owner_epoch FROM pdr_ai_v2_scenario_graph_builds
            WHERE build_key = ${build.buildKey}`);
        expect(row).toEqual({ owner_run_id: other.run.id, owner_epoch: 2 });
    });

    it("finds graph builds made from a deleted file and drops their snapshot", async () => {
        const accepted = await acceptRun(input(), credits, handle.db);
        const runId = accepted.run.id;
        const gone = `d${randomUUID().replace(/-/g, "")}`.slice(0, 64);
        const kept = `k${randomUUID().replace(/-/g, "")}`.slice(0, 64);
        // A manifest that read a file which no longer exists, and one that read none.
        await handle.db.execute(sql`
            INSERT INTO pdr_ai_v2_scenario_source_manifests
                (company_id, run_id, generation, manifest, manifest_hash, document_ids)
            VALUES (${companyId}, ${runId}, 1, '{}'::jsonb, ${gone}, '[987654321]'::jsonb)`);
        const other = await acceptRun(input(), credits, handle.db);
        await handle.db.execute(sql`
            INSERT INTO pdr_ai_v2_scenario_source_manifests
                (company_id, run_id, generation, manifest, manifest_hash, document_ids)
            VALUES (${companyId}, ${other.run.id}, 1, '{}'::jsonb, ${kept}, '[]'::jsonb)`);
        const addBuild = async (manifestHash: string) => {
            const [b] = await run<{ id: number }>(sql`
                INSERT INTO pdr_ai_v2_scenario_graph_builds
                    (company_id, build_key, group_id, manifest_hash, ontology_hash,
                     policy_version, state, owner_run_id)
                VALUES (${companyId}, ${`bk-${manifestHash}`.slice(0, 64)},
                        ${`g-${manifestHash}`.slice(0, 64)}, ${manifestHash},
                        ${"o".repeat(64)}, 'graphiti-extract@1', 'frozen', ${runId})
                RETURNING id`);
            await handle.db.execute(sql`
                INSERT INTO pdr_ai_v2_scenario_graph_snapshots
                    (company_id, build_id, data, graph_hash)
                VALUES (${companyId}, ${b!.id}, '{}'::jsonb, ${"h".repeat(64)})`);
            return b!.id;
        };
        const stale = await addBuild(gone);
        const fresh = await addBuild(kept);

        const found = await buildsWithDeletedSources(100, handle.db);
        expect(found.map(b => b.id)).toContain(stale);
        expect(found.map(b => b.id)).not.toContain(fresh);

        await markGraphBuildDeleted(stale, new Date(), handle.db);
        const snapshots = await run<{ build_id: number }>(sql`
            SELECT build_id FROM pdr_ai_v2_scenario_graph_snapshots
            WHERE build_id IN (${stale}, ${fresh})`);
        expect(snapshots.map(s => s.build_id)).toEqual([fresh]);
        expect((await buildsWithDeletedSources(100, handle.db)).map(b => b.id)).not.toContain(
            stale
        );
    });

    it("purges old raw replies and marks abandoned attempts unknown", async () => {
        const accepted = await acceptRun(input(), credits, handle.db);
        const d = deps();
        await stepV2(d, accepted.run.id); // sources
        await stepV2(d, accepted.run.id); // brief: one accepted attempt
        const { callId } = await store.openCall({
            scope: { companyId, runId: accepted.run.id, generation: 1, unitKey: "cast:plan" },
            logicalKey: randomUUID().replace(/-/g, ""),
            requestHash: "r".repeat(64),
            purpose: "cast",
            actorId: null,
            round: null,
        });
        await store.startAttempt({ companyId, callId, at: new Date(Date.now() - 3_600_000) });

        expect(
            await markAbandonedAttempts(new Date(Date.now() - 30 * 60_000), new Date(), handle.db)
        ).toBeGreaterThanOrEqual(1);
        expect((await store.getRun(accepted.run.id))!.flags?.unknownAttempts).toBe(1);

        expect(await purgeRawReplies(new Date(Date.now() + 1_000), handle.db)).toBeGreaterThan(0);
        const [left] = await run<{ n: number }>(sql`
            SELECT count(*)::int AS n FROM pdr_ai_v2_scenario_call_attempts WHERE raw_text IS NOT NULL`);
        expect(left!.n).toBe(0);
    });
});
