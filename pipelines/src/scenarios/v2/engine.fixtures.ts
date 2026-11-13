/**
 * Test doubles for the v2 engine: an in-memory `V2Store` with the same fence,
 * hold and journal rules as the Postgres store, a counting provider, and
 * stages that call the model the way real ones do. Used by engine.test.ts and
 * the store integration tests (which only take the spec and stages).
 */
import type { ModelRequest, SimulationModel } from "@launchstack/simulation";
import { llmChatTokens } from "@launchstack/store/credits";

import type { ScenarioRunRecord } from "../types";
import { EMPTY_USAGE, TERMINAL_STATUSES } from "../types";
import {
    CONTRACT_VERSION,
    DEFAULT_SOURCE_BUDGET,
    EMPTY_FLAGS,
    V2_VERSIONS,
    type RequestSpecV2,
    type UnitKind,
    type UnitRecord,
} from "./contracts";
import { settlementKey, type ReserveResult } from "./credits";
import type { LeaseFence, UnitCommit, V2Store } from "./engine";
import { hashOf } from "./hash";
import type { AcceptedReply } from "./journal";
import { buildInitialPlan, DEFAULT_POLICIES, firstFundedUnit } from "./plan";
import type { ArtifactReader, ArtifactWrite, Stage, StagePorts } from "./stage";

export function makeSpec(overrides: Partial<RequestSpecV2> = {}): RequestSpecV2 {
    return {
        contractVersion: CONTRACT_VERSION,
        kind: "scenario",
        title: "Price rise",
        subject: "We raise prices 20% in January.",
        agents: 4,
        rounds: 2,
        seed: 7,
        sources: {
            documentIds: [11],
            searchFiles: false,
            prospects: false,
            brandComments: false,
            companyProfile: false,
            notes: "",
        },
        contextMode: "passage",
        requestedContextMode: "passage",
        fallbackReason: null,
        budget: { maxCredits: 1_000_000, repairsPerUnit: 1 },
        policies: {
            versions: V2_VERSIONS,
            actorTokenCap: DEFAULT_POLICIES.actorTokenCap,
            sourceBudget: DEFAULT_SOURCE_BUDGET,
            castBatchSize: DEFAULT_POLICIES.castBatchSize,
            ingestBatchSize: DEFAULT_POLICIES.ingestBatchSize,
        },
        ...overrides,
    };
}

/** A provider that answers every request and counts calls. */
export function countingProvider(
    options: { tokens?: { input: number; output: number }; delayMs?: number } = {}
): SimulationModel & { calls: ModelRequest[]; fail?: (request: ModelRequest) => Error | null } {
    const tokens = options.tokens ?? { input: 100, output: 10 };
    const provider = {
        calls: [] as ModelRequest[],
        fail: undefined as ((request: ModelRequest) => Error | null) | undefined,
        async complete(request: ModelRequest) {
            provider.calls.push(request);
            if (options.delayMs) await new Promise(r => setTimeout(r, options.delayMs));
            const error = provider.fail?.(request);
            if (error) throw error;
            return {
                text: `reply:${request.prompt}`,
                usage: { inputTokens: tokens.input, outputTokens: tokens.output },
            };
        },
    };
    return provider;
}

const MODEL_UNITS: UnitKind[] = ["brief", "cast_plan", "cast_batch", "round", "report"];

const request = (unitKey: string, purpose: ModelRequest["purpose"]): ModelRequest => ({
    purpose,
    system: "test",
    prompt: unitKey,
    maxOutputTokens: 100,
});

const PURPOSE: Partial<Record<UnitKind, ModelRequest["purpose"]>> = {
    brief: "brief",
    cast_plan: "cast",
    cast_batch: "cast",
    round: "decide",
    report: "report",
};

/**
 * Stages that behave like the real ones at the seam: model units make one
 * journaled call, the sources unit writes a manifest, the report finishes the
 * run. `override` replaces a kind's stage.
 */
export function fakeStages(
    override: Partial<Record<UnitKind, Stage>> = {}
): Partial<Record<UnitKind, Stage>> {
    const stages: Partial<Record<UnitKind, Stage>> = {};
    const kinds: UnitKind[] = [
        "sources",
        "brief",
        "cast_plan",
        "actor_context",
        "cast_batch",
        "world_freeze",
        "round",
        "report",
    ];
    for (const kind of kinds) {
        stages[kind] = async ctx => {
            let text: string | null = null;
            if (MODEL_UNITS.includes(kind)) {
                const reply = await ctx.model.complete(request(ctx.unit.key, PURPOSE[kind]!));
                text = reply.text;
            }
            const writes: ArtifactWrite[] = [];
            if (kind === "sources") {
                writes.push({
                    type: "source_manifest",
                    manifest: {
                        version: 1,
                        collector: "test",
                        items: [],
                        omissions: [],
                        budget: ctx.spec.policies.sourceBudget,
                        usedTokens: 0,
                        documentIds: ctx.spec.sources.documentIds,
                        manifestHash: hashOf({ run: ctx.run.id }),
                    },
                });
            }
            return {
                output: { unit: ctx.unit.key, text },
                writes,
                run:
                    kind === "report"
                        ? { status: "done" as const, finishedAt: ctx.ports.now() }
                        : undefined,
            };
        };
    }
    return { ...stages, ...override };
}

export function fakePorts(now: () => Date): StagePorts {
    return {
        collectSources: async () => ({ sections: [], omissions: [] }),
        graph: null,
        now,
    };
}

interface Reservation {
    companyId: bigint;
    runId: number;
    unitKey: string;
    reserved: number;
    settled: number | null;
    status: "held" | "settled" | "released";
}

interface Attempt {
    id: number;
    callId: number;
    status: "started" | "succeeded" | "failed" | "unknown";
    text: string | null;
    inputTokens: number;
    outputTokens: number;
}

export interface MemoryStore extends V2Store {
    runs: Map<number, ScenarioRunRecord>;
    units: UnitRecord[];
    reservations: Map<string, Reservation>;
    debits: Array<{ companyId: bigint; amount: number; description: string; key: string }>;
    writes: Array<{ runId: number; unitKey: string; write: ArtifactWrite }>;
    attempts: Attempt[];
    ledger: { enforced: boolean; balance: Map<bigint, number> };
    hooks: {
        /** Runs at the start of a commit; throw to simulate a crash before it applies. */
        beforeCommit?: (commit: UnitCommit) => void | Promise<void>;
    };
    seedRun(spec: RequestSpecV2, options?: { companyId?: bigint }): ScenarioRunRecord;
    requestCancel(runId: number, at: Date): void;
    unit(runId: number, key: string): UnitRecord;
    reservation(runId: number, key: string): Reservation | undefined;
}

export function memoryStore(): MemoryStore {
    const runs = new Map<number, ScenarioRunRecord>();
    const specs = new Map<number, { spec: RequestSpecV2; specHash: string }>();
    const units: UnitRecord[] = [];
    const reservations = new Map<string, Reservation>();
    const debits: MemoryStore["debits"] = [];
    const writes: MemoryStore["writes"] = [];
    const calls = new Map<string, { id: number; acceptedAttemptId: number | null }>();
    const attempts: Attempt[] = [];
    const ledger = { enforced: false, balance: new Map<bigint, number>() };
    const hooks: MemoryStore["hooks"] = {};
    let nextId = 1;
    const id = () => nextId++;

    const active = (run: ScenarioRunRecord) => !TERMINAL_STATUSES.includes(run.status);
    const fenced = (fence: LeaseFence, allowCancel: boolean) => {
        const run = runs.get(fence.runId);
        if (!run || !active(run)) return undefined;
        if (run.leaseOwner !== fence.owner || run.leaseEpoch !== fence.epoch) return undefined;
        if (run.generation !== fence.generation) return undefined;
        if (!allowCancel && run.cancelRequestedAt) return undefined;
        return run;
    };
    const held = (companyId: bigint) =>
        [...reservations.values()]
            .filter(r => r.companyId === companyId && r.status === "held")
            .reduce((s, r) => s + r.reserved, 0);
    const reserve = (run: ScenarioRunRecord, unitKey: string, amount: number): ReserveResult => {
        const key = settlementKey(run.companyId, run.id, run.generation, unitKey);
        const existing = reservations.get(key);
        if (existing && existing.status !== "released")
            return {
                ok: true,
                key,
                reserved: existing.status === "held" ? existing.reserved : 0,
                reused: true,
            };
        const hold = ledger.enforced ? amount : 0;
        if (ledger.enforced && hold > 0) {
            const available = (ledger.balance.get(run.companyId) ?? 0) - held(run.companyId);
            if (available < hold) return { ok: false, key, required: hold, available };
        }
        reservations.set(key, {
            companyId: run.companyId,
            runId: run.id,
            unitKey,
            reserved: hold,
            settled: null,
            status: "held",
        });
        return { ok: true, key, reserved: hold, reused: false };
    };
    const releaseRun = (runId: number) => {
        for (const r of reservations.values())
            if (r.runId === runId && r.status === "held") r.status = "released";
    };
    const artifacts = (run: ScenarioRunRecord): ArtifactReader => {
        const committed = () =>
            units.filter(
                u =>
                    u.runId === run.id &&
                    u.generation === run.generation &&
                    u.status === "committed"
            );
        return {
            unitOutput: async <T>(key: string) =>
                committed().find(u => u.key === key)?.output as T | undefined,
            unitOutputs: async <T>(prefix: string) =>
                committed()
                    .filter(u => u.key.startsWith(prefix))
                    .sort((a, b) => a.key.localeCompare(b.key))
                    .map(u => ({ key: u.key, output: u.output as T })),
            sourceManifest: async () => {
                const w = writes.find(
                    x => x.runId === run.id && x.write.type === "source_manifest"
                );
                return w?.write.type === "source_manifest" ? w.write.manifest : undefined;
            },
            ontologySpec: async () => undefined,
            graphBuild: async () => undefined,
            graphBuildById: async () => undefined,
            graphIngestions: async () => [],
            graphSnapshot: async () => undefined,
            actorContexts: async () => [],
            worldSpec: async () => undefined,
            checkpoints: async () => [],
            pendingInjections: async () => [],
        };
    };

    const store: MemoryStore = {
        runs,
        units,
        reservations,
        debits,
        writes,
        attempts,
        ledger,
        hooks,
        seedRun(spec, options = {}) {
            const runId = id();
            const specId = id();
            specs.set(specId, { spec, specHash: hashOf(spec) });
            const run: ScenarioRunRecord = {
                id: runId,
                companyId: options.companyId ?? 5n,
                createdByUserId: "u1",
                kind: "scenario",
                title: spec.title,
                subject: spec.subject,
                status: "queued",
                step: 0,
                agentCount: spec.agents,
                roundCount: spec.rounds,
                seed: spec.seed,
                sources: spec.sources,
                evidence: null,
                brief: null,
                world: null,
                report: null,
                reception: null,
                estimate: { calls: 0, inputTokens: 0, outputTokens: 0, credits: 0 },
                usage: { ...EMPTY_USAGE },
                draft: null,
                draftHash: null,
                error: null,
                sharedAt: null,
                cancelRequestedAt: null,
                leaseUntil: null,
                createdAt: new Date("2026-11-13T00:00:00Z"),
                startedAt: null,
                finishedAt: null,
                eventsClosedAt: null,
                contractVersion: 2,
                requestSpecId: specId,
                worldSpecId: null,
                generation: 1,
                leaseOwner: null,
                leaseEpoch: 0,
                contextMode: spec.contextMode,
                flags: { ...EMPTY_FLAGS, contextMode: spec.contextMode },
            };
            const plan = buildInitialPlan(spec);
            const first = firstFundedUnit(plan);
            if (first) {
                const hold = reserve(run, first.key, first.maxCredits);
                if (!hold.ok) throw new Error("insufficient credits at acceptance");
            }
            runs.set(runId, run);
            for (const p of plan) {
                units.push({
                    ...p,
                    id: id(),
                    runId,
                    generation: 1,
                    status: "pending",
                    attempts: 0,
                    inputHash: "",
                    output: null,
                    usage: { calls: 0, inputTokens: 0, outputTokens: 0 },
                    credits: 0,
                    startedAt: null,
                    committedAt: null,
                    error: null,
                });
            }
            return structuredClone(run);
        },
        requestCancel(runId, at) {
            const run = runs.get(runId);
            if (run && active(run)) run.cancelRequestedAt = at;
        },
        unit(runId, key) {
            const u = units.find(x => x.runId === runId && x.key === key);
            if (!u) throw new Error(`no unit ${key}`);
            return u;
        },
        reservation(runId, key) {
            const run = runs.get(runId)!;
            return reservations.get(settlementKey(run.companyId, runId, run.generation, key));
        },

        async claimLease(runId, owner, now, until) {
            const run = runs.get(runId);
            if (!run || run.contractVersion !== 2 || !active(run)) return null;
            if (run.leaseUntil && run.leaseUntil.getTime() >= now.getTime()) return null;
            run.leaseOwner = owner;
            run.leaseEpoch += 1;
            run.leaseUntil = until;
            return { runId, owner, epoch: run.leaseEpoch, generation: run.generation };
        },
        async renewLease(fence, until) {
            const run = fenced(fence, true);
            if (!run) return false;
            run.leaseUntil = until;
            return true;
        },
        async releaseLease(fence, until) {
            const run = runs.get(fence.runId);
            if (!run || run.leaseOwner !== fence.owner || run.leaseEpoch !== fence.epoch)
                return false;
            run.leaseOwner = null;
            run.leaseUntil = until;
            return true;
        },
        async getRun(runId) {
            const run = runs.get(runId);
            return run ? structuredClone(run) : undefined;
        },
        async getSpec(specId) {
            return specs.get(specId);
        },
        async listUnits(runId, generation) {
            return structuredClone(
                units.filter(u => u.runId === runId && u.generation === generation)
            );
        },
        async reserve(fence, req) {
            const run = fenced(fence, true);
            if (!run) return null;
            return reserve(run, req.unitKey, req.amount);
        },
        async markUnitStarted(fence, unitId, inputHash, at) {
            const run = fenced(fence, true);
            if (!run) return null;
            const unit = units.find(u => u.id === unitId);
            if (!unit || (unit.status !== "pending" && unit.status !== "running")) return null;
            unit.status = "running";
            unit.attempts += 1;
            unit.inputHash = inputHash;
            unit.startedAt = at;
            run.status = "running";
            run.startedAt = run.startedAt ?? at;
            return structuredClone(unit);
        },
        async recordUnitError(fence, unitId, error) {
            if (!fenced(fence, true)) return false;
            const unit = units.find(u => u.id === unitId);
            if (unit) unit.error = error;
            return true;
        },
        async deferUnit(fence, unitId, wait) {
            const run = fenced(fence, true);
            if (!run) return false;
            const unit = units.find(u => u.id === unitId);
            if (unit && unit.status === "running") {
                unit.status = "pending";
                unit.attempts = Math.max(0, unit.attempts - 1);
            }
            run.flags = {
                ...EMPTY_FLAGS,
                ...run.flags,
                waitingSince: run.flags?.waitingSince ?? wait.waitingSince,
            };
            run.leaseOwner = null;
            run.leaseUntil = wait.retryAt;
            return true;
        },
        async commitUnit(fence, commit) {
            await hooks.beforeCommit?.(commit);
            const run = fenced(fence, false);
            if (!run) return false;
            const unit = units.find(u => u.id === commit.unit.id);
            if (!unit || (unit.status !== "pending" && unit.status !== "running")) return false;
            const key = settlementKey(run.companyId, run.id, run.generation, unit.key);
            const hold = reservations.get(key);
            if (hold && hold.status !== "held") return false;
            // Everything checked; apply as one step (the Postgres store does it in a transaction).
            unit.status = "committed";
            unit.output = commit.result.output ?? null;
            unit.usage = commit.usage;
            unit.credits = commit.credits;
            unit.committedAt = commit.at;
            for (const write of commit.result.writes ?? [])
                writes.push({ runId: run.id, unitKey: unit.key, write });
            for (const f of commit.result.followUps ?? []) {
                if (units.some(u => u.runId === run.id && u.key === f.key)) continue;
                units.push({
                    ...f,
                    id: id(),
                    runId: run.id,
                    generation: run.generation,
                    status: "pending",
                    attempts: 0,
                    inputHash: "",
                    output: null,
                    usage: { calls: 0, inputTokens: 0, outputTokens: 0 },
                    credits: 0,
                    startedAt: null,
                    committedAt: null,
                    error: null,
                });
            }
            const patch = commit.result.run ?? {};
            const flags = { ...EMPTY_FLAGS, ...run.flags };
            run.flags = {
                ...flags,
                ...patch.flags,
                unknownAttempts: flags.unknownAttempts,
                waitingSince: null,
            };
            run.step += 1;
            run.usage = {
                calls: run.usage.calls + commit.usage.calls,
                inputTokens: run.usage.inputTokens + commit.usage.inputTokens,
                outputTokens: run.usage.outputTokens + commit.usage.outputTokens,
                credits: run.usage.credits + commit.credits,
            };
            run.status = patch.status === "done" ? "done" : "running";
            if (patch.brief) run.brief = patch.brief;
            if (patch.status === "done") {
                run.finishedAt = patch.finishedAt ?? commit.at;
                run.leaseOwner = null;
                run.leaseUntil = null;
            }
            reservations.set(key, {
                companyId: run.companyId,
                runId: run.id,
                unitKey: unit.key,
                reserved: hold?.reserved ?? 0,
                settled: commit.credits,
                status: "settled",
            });
            if (commit.credits > 0) {
                ledger.balance.set(
                    run.companyId,
                    (ledger.balance.get(run.companyId) ?? 0) - commit.credits
                );
                debits.push({
                    companyId: run.companyId,
                    amount: commit.credits,
                    description: commit.settlement.description,
                    key,
                });
            }
            if (patch.status === "done") releaseRun(run.id);
            return true;
        },
        async finishRun(fence, outcome) {
            const run = fenced(fence, true);
            if (!run) return false;
            run.status = outcome.status;
            run.error = outcome.error;
            run.finishedAt = outcome.at;
            run.leaseOwner = null;
            run.leaseUntil = null;
            if (outcome.failedUnitId !== undefined) {
                const unit = units.find(u => u.id === outcome.failedUnitId);
                if (unit && (unit.status === "pending" || unit.status === "running"))
                    unit.status = "failed";
            }
            releaseRun(run.id);
            return true;
        },
        async closeEvents(runId, at) {
            const run = runs.get(runId);
            if (run) run.eventsClosedAt = run.eventsClosedAt ?? at;
        },
        artifacts,

        async openCall(input) {
            let call = calls.get(input.logicalKey);
            if (!call) {
                call = { id: id(), acceptedAttemptId: null };
                calls.set(input.logicalKey, call);
            }
            const accepted = attempts.find(a => a.id === call.acceptedAttemptId);
            const reply: AcceptedReply | null =
                accepted && accepted.text !== null
                    ? {
                          attemptId: accepted.id,
                          text: accepted.text,
                          inputTokens: accepted.inputTokens,
                          outputTokens: accepted.outputTokens,
                      }
                    : null;
            return { callId: call.id, accepted: reply };
        },
        async startAttempt(input) {
            const attempt = attempts.filter(a => a.callId === input.callId).length + 1;
            const row: Attempt = {
                id: id(),
                callId: input.callId,
                status: "started",
                text: null,
                inputTokens: 0,
                outputTokens: 0,
            };
            attempts.push(row);
            return { attemptId: row.id, attempt };
        },
        async acceptAttempt(input) {
            const row = attempts.find(a => a.id === input.attemptId)!;
            Object.assign(row, {
                status: "succeeded",
                text: input.text,
                inputTokens: input.inputTokens,
                outputTokens: input.outputTokens,
            });
            const call = [...calls.values()].find(c => c.id === input.callId)!;
            if (call.acceptedAttemptId === null) call.acceptedAttemptId = row.id;
            const accepted = attempts.find(a => a.id === call.acceptedAttemptId)!;
            return {
                attemptId: accepted.id,
                text: accepted.text!,
                inputTokens: accepted.inputTokens,
                outputTokens: accepted.outputTokens,
            };
        },
        async failAttempt(input) {
            const row = attempts.find(a => a.id === input.attemptId);
            if (!row || row.status !== "started") return;
            row.status = input.status;
            if (input.status === "unknown") {
                const run = runs.get(input.runId);
                if (run)
                    run.flags = {
                        ...EMPTY_FLAGS,
                        ...run.flags,
                        unknownAttempts: (run.flags?.unknownAttempts ?? 0) + 1,
                    };
            }
        },
    };
    return store;
}

/** Credits one fake model call costs at the counting provider's default tokens. */
export const CALL_CREDITS = llmChatTokens(100, 10);
