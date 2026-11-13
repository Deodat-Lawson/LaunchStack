/**
 * The durable engine for contract v2 runs.
 *
 * A run is a persisted plan of units (plan.ts). `advanceV2` performs at most
 * one of them under a fenced lease:
 *
 *   claim lease → load run (v2 only) → terminal? stop → cancel requested? stop
 *   → authorize → next ready unit → reserve its credits → mark it started
 *   → run its stage (journaled model) → commit (fenced, settles the hold)
 *
 * The lease is (owner token, epoch): a claim bumps the epoch, and every write
 * that advances, settles or fails the run must match the owner, the epoch and
 * the generation. A worker whose lease lapsed and was taken over can finish
 * its model calls, but it can never commit them, charge for them or fail the
 * run; the journal hands its accepted replies to whoever runs the unit next.
 *
 * Hosts drive it: `driveV2` in-process with a heartbeat (local dev), or
 * `stepV2` once per Inngest step on the worker.
 */
import { randomUUID } from "node:crypto";

import { llmChatTokens } from "@launchstack/store/credits";
import type { SimulationModel, Usage } from "@launchstack/simulation";

import type { ScenarioRunRecord } from "../types";
import { OutOfCreditsError } from "../run";
import { TERMINAL_STATUSES } from "../types";
import type { RequestSpecV2, UnitKind, UnitRecord } from "./contracts";
import { settlementDescription, settlementKey, type ReserveResult } from "./credits";
import { hashOf } from "./hash";
import { createJournaledModel, type CallJournalStore } from "./journal";
import { matchesDependency } from "./plan";
import {
    RetryLaterError,
    type ArtifactReader,
    type Stage,
    type StageContext,
    type StagePorts,
    type StageResult,
} from "./stage";

// ─── Errors ──────────────────────────────────────────────────────────────────

/** The creator can no longer read the run's sources (or left the workspace). */
export class AccessRevokedError extends Error {
    constructor(message = "Access to this run's sources changed") {
        super(message);
        this.name = "AccessRevokedError";
    }
}

/** A commit that the run still owns was refused (a conflicting artifact write). Counts as a failed attempt. */
export class CommitRefusedError extends Error {
    constructor(unitKey: string) {
        super(`The ${unitKey} unit could not be saved`);
        this.name = "CommitRefusedError";
    }
}

/** What a failed run shows. Generic on purpose: no source names reach the run row. */
export const RUN_MESSAGES = {
    accessRevoked: "The run stopped because its creator can no longer open some of its sources.",
    outOfCredits: new OutOfCreditsError().message,
    graphUnavailable: "The run stopped because the graph service stayed unavailable.",
    missingSpec: "The run's request could not be found.",
    unitFailed: "The run failed.",
    stalled: "The run stopped making progress.",
} as const;

// ─── Store ───────────────────────────────────────────────────────────────────

export interface LeaseFence {
    runId: number;
    owner: string;
    epoch: number;
    generation: number;
}

export interface UnitCommit {
    unit: UnitRecord;
    result: StageResult;
    /** Billed usage: accepted attempts plus the stage's extra usage. */
    usage: Usage;
    credits: number;
    durationMs: number;
    at: Date;
    settlement: { description: string };
}

/**
 * Persistence the engine needs. Every method taking a fence is a no-op
 * (null / false) unless the run still matches it.
 */
export interface V2Store extends CallJournalStore {
    /** Take the run's lease if it is free (none, or lapsed): bumps the epoch. */
    claimLease(runId: number, owner: string, now: Date, until: Date): Promise<LeaseFence | null>;
    renewLease(fence: LeaseFence, until: Date): Promise<boolean>;
    /** Let the lease go; `until` keeps others off it until then (a short backoff). */
    releaseLease(fence: LeaseFence, until: Date | null): Promise<boolean>;
    getRun(runId: number): Promise<ScenarioRunRecord | undefined>;
    getSpec(requestSpecId: number): Promise<{ spec: RequestSpecV2; specHash: string } | undefined>;
    listUnits(runId: number, generation: number): Promise<UnitRecord[]>;
    /** Hold a unit's credits (idempotent by settlement key). Null when the fence no longer matches. */
    reserve(
        fence: LeaseFence,
        request: { companyId: bigint; unitKey: string; amount: number }
    ): Promise<ReserveResult | null>;
    /** pending|running → running, attempts + 1, input hash; the run goes queued → running. */
    markUnitStarted(
        fence: LeaseFence,
        unitId: number,
        inputHash: string,
        at: Date
    ): Promise<UnitRecord | null>;
    recordUnitError(fence: LeaseFence, unitId: number, error: string): Promise<boolean>;
    /** The unit waits: back to pending without counting the attempt, the run notes when waiting began, the lease goes with a backoff. */
    deferUnit(
        fence: LeaseFence,
        unitId: number,
        wait: { waitingSince: string; retryAt: Date }
    ): Promise<boolean>;
    /** The fenced commit transaction (see store.ts). False when anything refused it; nothing is applied then. */
    commitUnit(fence: LeaseFence, commit: UnitCommit): Promise<boolean>;
    /** Terminal failure or cancellation; releases every hold the run still has. */
    finishRun(
        fence: LeaseFence,
        outcome: {
            status: "failed" | "cancelled";
            error: string | null;
            at: Date;
            failedUnitId?: number;
        }
    ): Promise<boolean>;
    closeEvents(runId: number, at: Date): Promise<void>;
    artifacts(run: ScenarioRunRecord): ArtifactReader;
}

// ─── Deps and outcomes ───────────────────────────────────────────────────────

export interface EngineDeps {
    store: V2Store;
    /** The provider; the engine wraps it in the journal for each unit. */
    model: SimulationModel;
    stages: Partial<Record<UnitKind, Stage>>;
    stagePorts: StagePorts;
    /** Recheck the creator may still read the run's sources; throw AccessRevokedError when not. */
    authorize(run: ScenarioRunRecord): Promise<void>;
    now(): Date;
    log?(message: string, meta?: Record<string, unknown>): void;
    /** Parallel model calls inside a unit (default 6). */
    concurrency?: number;
    /** Lease length; a heartbeat renews it every third (default 2 min). */
    leaseMs?: number;
    /** Attempts per unit before the run fails (default 3). */
    maxAttempts?: number;
    /** Longest a run waits on RetryLaterError before it fails (default 30 min). */
    maxWaitMs?: number;
    /** Ceiling on one wait's backoff (default 60 s). */
    maxBackoffMs?: number;
}

export const ENGINE_DEFAULTS = {
    leaseMs: 2 * 60_000,
    maxAttempts: 3,
    maxWaitMs: 30 * 60_000,
    maxBackoffMs: 60_000,
    concurrency: 6,
} as const;

export type SkipReason =
    | "missing"
    | "not_v2"
    | "leased"
    | "fenced"
    | "no_ready_unit"
    | "lease_lost"
    | "errors";

export type AdvanceV2Outcome =
    | { state: "advanced"; unitKey: string }
    | { state: "done" | "failed" | "cancelled" }
    | { state: "waiting"; unitKey: string; retryAt: Date }
    | { state: "skipped"; reason: SkipReason };

export function newLeaseOwner(prefix = "drv"): string {
    return `${prefix}:${randomUUID()}`.slice(0, 64);
}

function errorMessage(error: unknown): string {
    if (error instanceof Error && error.message) return error.message.slice(0, 2_000);
    return RUN_MESSAGES.unitFailed;
}

const satisfied = (u: UnitRecord) => u.status === "committed" || u.status === "skipped";

/** Whether every dependency of `unit` is satisfied; a "prefix*" entry waits for every unit it matches. */
export function dependenciesMet(unit: UnitRecord, units: UnitRecord[]): boolean {
    return unit.dependsOn.every(dep => {
        const matching = units.filter(u => matchesDependency(dep, u.key));
        if (dep.endsWith("*")) return matching.every(satisfied);
        return matching.length > 0 && matching.every(satisfied);
    });
}

/** The lowest-seq unit that still has work and whose dependencies are committed. */
export function nextReadyUnit(units: UnitRecord[]): UnitRecord | undefined {
    return [...units]
        .sort((a, b) => a.seq - b.seq || a.key.localeCompare(b.key))
        .find(u => (u.status === "pending" || u.status === "running") && dependenciesMet(u, units));
}

/** A unit's resolved inputs: its own input, the spec, and what its dependencies committed. */
export function unitInputHash(unit: UnitRecord, units: UnitRecord[], specHash: string): string {
    const deps = units
        .filter(u => unit.dependsOn.some(dep => matchesDependency(dep, u.key)))
        .sort((a, b) => a.key.localeCompare(b.key))
        .map(u => ({ key: u.key, output: hashOf(u.output ?? null) }));
    return hashOf({ key: unit.key, kind: unit.kind, input: unit.input, specHash, deps });
}

function addUsage(a: Usage, b: StageResult["extraUsage"]): Usage {
    if (!b) return a;
    return {
        calls: a.calls + b.calls,
        inputTokens: a.inputTokens + b.inputTokens,
        outputTokens: a.outputTokens + b.outputTokens,
    };
}

function fenceMatches(run: ScenarioRunRecord, fence: LeaseFence): boolean {
    return (
        run.leaseOwner === fence.owner &&
        run.leaseEpoch === fence.epoch &&
        run.generation === fence.generation
    );
}

// ─── One unit ────────────────────────────────────────────────────────────────

/** Perform the run's next unit under a lease the caller holds. */
export async function advanceWithFence(
    deps: EngineDeps,
    fence: LeaseFence
): Promise<AdvanceV2Outcome> {
    const { store } = deps;
    const maxAttempts = deps.maxAttempts ?? ENGINE_DEFAULTS.maxAttempts;
    const run = await store.getRun(fence.runId);
    if (!run) return { state: "skipped", reason: "missing" };
    if (run.contractVersion !== 2) return { state: "skipped", reason: "not_v2" };
    if (TERMINAL_STATUSES.includes(run.status))
        return { state: run.status as "done" | "failed" | "cancelled" };
    if (!fenceMatches(run, fence)) return { state: "skipped", reason: "fenced" };

    const fail = async (error: string, failedUnitId?: number): Promise<AdvanceV2Outcome> => {
        const ok = await store.finishRun(fence, {
            status: "failed",
            error,
            at: deps.now(),
            failedUnitId,
        });
        return ok ? { state: "failed" } : { state: "skipped", reason: "fenced" };
    };
    const cancel = async (): Promise<AdvanceV2Outcome> => {
        const ok = await store.finishRun(fence, {
            status: "cancelled",
            error: null,
            at: deps.now(),
        });
        return ok ? { state: "cancelled" } : { state: "skipped", reason: "fenced" };
    };

    if (run.cancelRequestedAt) return cancel();

    try {
        await deps.authorize(run);
    } catch (error) {
        if (error instanceof AccessRevokedError) {
            deps.log?.("scenario v2 run stopped: access revoked", { runId: run.id });
            return fail(RUN_MESSAGES.accessRevoked);
        }
        throw error;
    }

    const specRow = run.requestSpecId ? await store.getSpec(run.requestSpecId) : undefined;
    if (!specRow) return fail(RUN_MESSAGES.missingSpec);

    const units = await store.listUnits(run.id, run.generation);
    const unit = nextReadyUnit(units);
    if (!unit) {
        // Unfinished, yet nothing can run: every unit committed without the
        // report finishing the run, or a dependency that can never be met.
        // Failing now beats being re-dispatched forever.
        deps.log?.("scenario v2 run has no runnable unit", {
            runId: run.id,
            open: units.filter(u => u.status === "pending" || u.status === "running").length,
        });
        return fail(RUN_MESSAGES.stalled);
    }

    // A unit that keeps killing its worker never records an error; its
    // attempt count still climbs, so it cannot loop forever.
    if (unit.attempts >= maxAttempts) return fail(unit.error ?? RUN_MESSAGES.unitFailed, unit.id);

    const hold = await store.reserve(fence, {
        companyId: run.companyId,
        unitKey: unit.key,
        amount: unit.maxCredits,
    });
    if (!hold) return { state: "skipped", reason: "fenced" };
    if (!hold.ok) {
        deps.log?.("scenario v2 run stopped: not enough credits", {
            runId: run.id,
            unit: unit.key,
            required: hold.required,
            available: hold.available,
        });
        return fail(RUN_MESSAGES.outOfCredits, unit.id);
    }

    const startedAt = deps.now();
    const started = await store.markUnitStarted(
        fence,
        unit.id,
        unitInputHash(unit, units, specRow.specHash),
        startedAt
    );
    if (!started) return { state: "skipped", reason: "fenced" };

    const journal = createJournaledModel({
        store,
        provider: deps.model,
        scope: {
            companyId: run.companyId,
            runId: run.id,
            generation: run.generation,
            unitKey: unit.key,
        },
        round: unit.kind === "round" ? Number(unit.input.round ?? 0) || null : null,
        versions: specRow.spec.policies.versions,
        now: deps.now,
    });
    const ctx: StageContext = {
        run,
        spec: specRow.spec,
        mode: run.contextMode ?? specRow.spec.contextMode,
        unit: started,
        model: journal.model,
        artifacts: store.artifacts(run),
        ports: deps.stagePorts,
        concurrency: deps.concurrency ?? ENGINE_DEFAULTS.concurrency,
        closeEvents: () => store.closeEvents(run.id, deps.now()),
    };
    const clockStart = Date.now();

    try {
        const stage = deps.stages[unit.kind];
        if (!stage) throw new Error(`No stage handles ${unit.kind} units`);
        const result = await stage(ctx);
        const usage = addUsage(journal.usage(), result.extraUsage);
        const committed = await store.commitUnit(fence, {
            unit: started,
            result,
            usage,
            credits: llmChatTokens(usage.inputTokens, usage.outputTokens),
            durationMs: Date.now() - clockStart,
            at: deps.now(),
            settlement: { description: settlementDescription(run.title, unit.key) },
        });
        if (committed) {
            return result.run?.status === "done"
                ? { state: "done" }
                : { state: "advanced", unitKey: unit.key };
        }
        // Refused: find out whether the run moved on without us.
        const after = await store.getRun(run.id);
        if (!after) return { state: "skipped", reason: "missing" };
        if (TERMINAL_STATUSES.includes(after.status))
            return { state: after.status as "done" | "failed" | "cancelled" };
        if (!fenceMatches(after, fence)) return { state: "skipped", reason: "fenced" };
        // Cancellation won the commit guard: the unit's work is dropped, its
        // hold released; what earlier units committed and charged stands.
        if (after.cancelRequestedAt) return cancel();
        throw new CommitRefusedError(unit.key);
    } catch (error) {
        if (error instanceof RetryLaterError) {
            const now = deps.now();
            const since = run.flags?.waitingSince ? new Date(run.flags.waitingSince) : now;
            const maxWait = deps.maxWaitMs ?? ENGINE_DEFAULTS.maxWaitMs;
            if (now.getTime() - since.getTime() > maxWait) {
                deps.log?.("scenario v2 run stopped: waited too long", {
                    runId: run.id,
                    unit: unit.key,
                    reason: error.message,
                });
                return fail(RUN_MESSAGES.graphUnavailable, unit.id);
            }
            const backoff = Math.max(
                1_000,
                Math.min(error.afterMs, deps.maxBackoffMs ?? ENGINE_DEFAULTS.maxBackoffMs)
            );
            const retryAt = new Date(now.getTime() + backoff);
            const ok = await store.deferUnit(fence, started.id, {
                waitingSince: since.toISOString(),
                retryAt,
            });
            return ok
                ? { state: "waiting", unitKey: unit.key, retryAt }
                : { state: "skipped", reason: "fenced" };
        }
        if (error instanceof AccessRevokedError) {
            // A stage found it can no longer read a source: no retry will
            // help, and its message may name the source, so it stays in logs.
            deps.log?.("scenario v2 run stopped: access revoked mid-unit", {
                runId: run.id,
                unit: unit.key,
            });
            await store.recordUnitError(fence, started.id, RUN_MESSAGES.accessRevoked);
            return fail(RUN_MESSAGES.accessRevoked, started.id);
        }
        const message = errorMessage(error);
        await store.recordUnitError(fence, started.id, message);
        deps.log?.("scenario v2 unit failed", {
            runId: run.id,
            unit: unit.key,
            attempt: started.attempts,
            error: message,
        });
        if (started.attempts >= maxAttempts) return fail(message, started.id);
        throw error;
    }
}

// ─── Lease handling and drivers ──────────────────────────────────────────────

interface Held {
    fence: LeaseFence;
    lost: () => boolean;
    stop: () => void;
}

async function holdLease(deps: EngineDeps, runId: number, owner: string): Promise<Held | null> {
    const leaseMs = deps.leaseMs ?? ENGINE_DEFAULTS.leaseMs;
    const now = deps.now();
    const fence = await deps.store.claimLease(runId, owner, now, new Date(now.getTime() + leaseMs));
    if (!fence) return null;
    let lost = false;
    // Heartbeat: a slow round outlasts the lease; keep it fresh so nobody
    // takes a live worker for a dead one. A renewal that no longer matches
    // means someone else holds the run now.
    const timer = setInterval(
        () => {
            deps.store
                .renewLease(fence, new Date(deps.now().getTime() + leaseMs))
                .then(ok => {
                    if (!ok) lost = true;
                })
                .catch((error: unknown) =>
                    deps.log?.("scenario v2 lease renewal failed", { runId, error: String(error) })
                );
        },
        Math.max(1_000, Math.floor(leaseMs / 3))
    );
    timer.unref?.();
    return { fence, lost: () => lost, stop: () => clearInterval(timer) };
}

/** Why a claim found nothing to hold: the run finished, is not v2, is gone, or someone else holds it. */
async function unclaimed(deps: EngineDeps, runId: number): Promise<AdvanceV2Outcome> {
    const run = await deps.store.getRun(runId);
    if (!run) return { state: "skipped", reason: "missing" };
    if (run.contractVersion !== 2) return { state: "skipped", reason: "not_v2" };
    if (TERMINAL_STATUSES.includes(run.status))
        return { state: run.status as "done" | "failed" | "cancelled" };
    return { state: "skipped", reason: "leased" };
}

async function letGo(deps: EngineDeps, held: Held): Promise<void> {
    held.stop();
    // Fenced: after a terminal transition or a wait the owner is already
    // cleared and this matches nothing.
    await deps.store.releaseLease(held.fence, null).catch((error: unknown) =>
        deps.log?.("scenario v2 lease release failed", {
            runId: held.fence.runId,
            error: String(error),
        })
    );
}

/**
 * One unit under a lease of its own (an Inngest step). Errors propagate so
 * the host retries; the lease is let go first.
 */
export async function stepV2(
    deps: EngineDeps,
    runId: number,
    options: { owner?: string } = {}
): Promise<AdvanceV2Outcome> {
    const held = await holdLease(deps, runId, options.owner ?? newLeaseOwner());
    if (!held) return unclaimed(deps, runId);
    try {
        return await advanceWithFence(deps, held.fence);
    } finally {
        await letGo(deps, held);
    }
}

/** Kept for symmetry with v1's `advanceRun`: one unit, claiming its own lease. */
export const advanceV2 = stepV2;

export interface DriveV2Options {
    owner?: string;
    /** Stop after this many units (default: until the run stops advancing). */
    maxUnits?: number;
    /** Wrap each unit (the host's model scope). */
    around?: <T>(fn: () => Promise<T>) => Promise<T>;
    /** Back off between failed attempts (default 1.5 s × attempt). */
    backoffMs?: number;
    /** Errors in a row (before a unit counts them) after which the driver gives up and lets the reconciler resume. */
    maxConsecutiveErrors?: number;
    sleep?: (ms: number) => Promise<void>;
}

export interface DriveV2Result {
    last: AdvanceV2Outcome;
    units: number;
}

const defaultSleep = (ms: number) =>
    new Promise<void>(resolve => {
        const t = setTimeout(resolve, ms);
        t.unref?.();
    });

/**
 * Drive a run in this process for as long as it advances, holding one lease
 * across units. A failed attempt is retried after a backoff; the unit's own
 * attempt count decides when the run fails.
 */
export async function driveV2(
    deps: EngineDeps,
    runId: number,
    options: DriveV2Options = {}
): Promise<DriveV2Result> {
    const held = await holdLease(deps, runId, options.owner ?? newLeaseOwner());
    if (!held) return { last: await unclaimed(deps, runId), units: 0 };
    const around = options.around ?? (<T>(fn: () => Promise<T>) => fn());
    const sleep = options.sleep ?? defaultSleep;
    const maxUnits = options.maxUnits ?? Number.POSITIVE_INFINITY;
    const maxErrors = options.maxConsecutiveErrors ?? 5;
    let last: AdvanceV2Outcome = { state: "skipped", reason: "no_ready_unit" };
    let units = 0;
    let errors = 0;
    try {
        while (units < maxUnits) {
            if (held.lost()) {
                last = { state: "skipped", reason: "lease_lost" };
                break;
            }
            try {
                last = await around(() => advanceWithFence(deps, held.fence));
                errors = 0;
            } catch (error) {
                errors += 1;
                deps.log?.("scenario v2 attempt failed; retrying", {
                    runId,
                    error: errorMessage(error),
                });
                if (errors >= maxErrors) {
                    last = { state: "skipped", reason: "errors" };
                    break;
                }
                await sleep((options.backoffMs ?? 1_500) * errors);
                continue;
            }
            if (last.state !== "advanced") break;
            units += 1;
        }
        return { last, units };
    } finally {
        await letGo(deps, held);
    }
}
