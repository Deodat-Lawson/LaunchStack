/**
 * Persistence for contract v2 runs: acceptance, the fenced lease, units, the
 * call journal, the commit transaction, committed-artifact reads, and the
 * dispatch outbox the reconciler drains.
 *
 * Fencing: every write that moves a run forward (reserve, start, commit,
 * defer, fail) first locks the run row on (id, lease_owner, lease_epoch,
 * generation, active status). A worker whose lease was taken over matches
 * nothing, so it can never advance, settle or fail the run.
 */
import { and, asc, eq, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";

import { getDb, toRows, type DbClient } from "@launchstack/store/client";
import { document } from "@launchstack/store/schema";

import { toRunRecord } from "../db";
import {
    scenarioActorContexts,
    scenarioCallAttempts,
    scenarioCalls,
    scenarioCheckpoints,
    scenarioCreditReservations,
    scenarioDispatches,
    scenarioGraphBuilds,
    scenarioGraphIngestions,
    scenarioGraphSnapshots,
    scenarioInjections,
    scenarioOntologySpecs,
    scenarioRequestSpecs,
    scenarioRuns,
    scenarioSourceManifests,
    scenarioUnits,
    scenarioWorldSpecs,
    type ScenarioGraphBuildRow,
    type ScenarioRunRow,
    type ScenarioUnitRow,
} from "../schema";
import type { RunEstimateStored, ScenarioRunRecord } from "../types";
import { EMPTY_USAGE, TERMINAL_STATUSES } from "../types";
import {
    EMPTY_FLAGS,
    type RequestSpecV2,
    type RunFlagsV2,
    type UnitRecord,
    type UnitStatus,
} from "./contracts";
import type { ScenarioCreditsPort } from "./credits";
import type { LeaseFence, UnitCommit, V2Store } from "./engine";
import { hashOf } from "./hash";
import type { AcceptedReply } from "./journal";
import { buildInitialPlan, firstFundedUnit } from "./plan";
import type { ArtifactReader, ArtifactWrite, GraphBuildRecord } from "./stage";

// The credit-hold port ships with the store: this module is the package's
// `scenarios/v2/db` entry, and hosts implement the ledger side of it.
export {
    createScenarioCredits,
    heldCredits,
    settlementDescription,
    settlementKey,
    type CreditsTx,
    type ReserveRequest,
    type ReserveResult,
    type ScenarioCreditsPort,
    type ScenarioLedger,
    type SettleRequest,
    type SettleResult,
} from "./credits";

type Tx = Parameters<Parameters<DbClient["transaction"]>[0]>[0];

const ACTIVE = ["queued", "running"] as const;
const OPEN_UNIT: UnitStatus[] = ["pending", "running"];

// ─── Errors ──────────────────────────────────────────────────────────────────

/** Same Idempotency-Key, different payload: the route answers 409. */
export class IdempotencyConflictError extends Error {
    constructor() {
        super("This Idempotency-Key was already used for a different request.");
        this.name = "IdempotencyConflictError";
    }
}

/** The first unit's hold was refused; nothing was created. */
export class InsufficientCreditsError extends Error {
    constructor(
        readonly required: number,
        readonly available: number
    ) {
        super("The workspace does not have enough credits to start this run.");
        this.name = "InsufficientCreditsError";
    }
}

/** Thrown inside a transaction to roll it back; never escapes the store. */
class Refused extends Error {
    constructor(readonly reason: string) {
        super(reason);
        this.name = "Refused";
    }
}

// ─── Mapping ─────────────────────────────────────────────────────────────────

function toUnit(row: ScenarioUnitRow): UnitRecord {
    return {
        id: row.id,
        runId: row.runId,
        generation: row.generation,
        key: row.unitKey,
        kind: row.kind,
        seq: row.seq,
        dependsOn: row.dependsOn,
        input: row.input,
        maxCredits: row.maxCredits,
        status: row.status,
        attempts: row.attempts,
        inputHash: row.inputHash ?? "",
        output: row.output ?? null,
        usage: row.usage ?? { calls: 0, inputTokens: 0, outputTokens: 0 },
        credits: row.credits,
        startedAt: row.startedAt ?? null,
        committedAt: row.committedAt ?? null,
        error: row.error ?? null,
    };
}

function toBuild(row: ScenarioGraphBuildRow, ownerLive?: boolean): GraphBuildRecord {
    return {
        ...(ownerLive === undefined ? {} : { ownerLive }),
        id: row.id,
        companyId: row.companyId,
        buildKey: row.buildKey,
        groupId: row.groupId,
        state: row.state,
        ownerRunId: row.ownerRunId ?? null,
        ownerEpoch: row.ownerEpoch,
        manifestHash: row.manifestHash,
        ontologyHash: row.ontologyHash,
        policyVersion: row.policyVersion,
        snapshotId: row.snapshotId ?? null,
        error: row.error ?? null,
    };
}

function flagsOf(run: Pick<ScenarioRunRow, "flags" | "contextMode">): RunFlagsV2 {
    return {
        ...EMPTY_FLAGS,
        contextMode: (run.contextMode as RunFlagsV2["contextMode"] | null) ?? "passage",
        ...(run.flags ?? {}),
    };
}

// ─── Acceptance ──────────────────────────────────────────────────────────────

export interface AcceptRunInput {
    companyId: bigint;
    createdByUserId: string;
    idempotencyKey: string | null;
    /** sha-256 of the normalized create payload. */
    payloadHash: string;
    spec: RequestSpecV2;
    estimate: RunEstimateStored;
    flags: RunFlagsV2;
}

export interface DispatchSummary {
    id: number;
    eventId: string;
    status: string;
}

export interface AcceptRunResult {
    created: boolean;
    run: ScenarioRunRecord;
    requestSpecId: number;
    dispatch: DispatchSummary;
}

/** The first delivery of a run generation; the reconciler appends `:r<n>` for later ones. */
export function dispatchEventId(runId: number, generation: number, redispatch = 0): string {
    const base = `scenario-run:${runId}:g${generation}`;
    return redispatch > 0 ? `${base}:r${redispatch}` : base;
}

async function findSpecByKey(tx: Tx, input: AcceptRunInput) {
    if (!input.idempotencyKey) return undefined;
    const [row] = await tx
        .select({ id: scenarioRequestSpecs.id, payloadHash: scenarioRequestSpecs.payloadHash })
        .from(scenarioRequestSpecs)
        .where(
            and(
                eq(scenarioRequestSpecs.companyId, input.companyId),
                eq(scenarioRequestSpecs.createdByUserId, input.createdByUserId),
                eq(scenarioRequestSpecs.idempotencyKey, input.idempotencyKey)
            )
        )
        .limit(1);
    return row;
}

async function replayAcceptance(
    tx: Tx,
    prior: { id: number; payloadHash: string },
    input: AcceptRunInput
): Promise<AcceptRunResult> {
    if (prior.payloadHash !== input.payloadHash) throw new IdempotencyConflictError();
    const [run] = await tx
        .select()
        .from(scenarioRuns)
        .where(
            and(
                eq(scenarioRuns.requestSpecId, prior.id),
                eq(scenarioRuns.companyId, input.companyId)
            )
        )
        .limit(1);
    if (!run) throw new Error(`Request spec ${prior.id} has no run`);
    const [dispatch] = await tx
        .select({
            id: scenarioDispatches.id,
            eventId: scenarioDispatches.eventId,
            status: scenarioDispatches.status,
        })
        .from(scenarioDispatches)
        .where(eq(scenarioDispatches.runId, run.id))
        .orderBy(asc(scenarioDispatches.id))
        .limit(1);
    if (!dispatch) throw new Error(`Run ${run.id} has no dispatch`);
    return { created: false, run: toRunRecord(run), requestSpecId: prior.id, dispatch };
}

/**
 * Accept a run in one transaction: the frozen RequestSpec (with the
 * idempotency record), the run, its initial units, a hold for the first unit
 * with model work, and a dispatch row. The caller publishes the dispatch after
 * this returns; if it never gets to, the reconciler does.
 */
export async function acceptRun(
    input: AcceptRunInput,
    credits: ScenarioCreditsPort,
    db: DbClient = getDb()
): Promise<AcceptRunResult> {
    const { spec } = input;
    return db.transaction(async tx => {
        const prior = await findSpecByKey(tx, input);
        if (prior) return replayAcceptance(tx, prior, input);

        const [specRow] = await tx
            .insert(scenarioRequestSpecs)
            .values({
                companyId: input.companyId,
                createdByUserId: input.createdByUserId,
                idempotencyKey: input.idempotencyKey,
                payloadHash: input.payloadHash,
                spec,
                specHash: hashOf(spec),
            })
            .onConflictDoNothing({
                target: [
                    scenarioRequestSpecs.companyId,
                    scenarioRequestSpecs.createdByUserId,
                    scenarioRequestSpecs.idempotencyKey,
                ],
            })
            .returning({ id: scenarioRequestSpecs.id });
        if (!specRow) {
            // A concurrent request with the same key committed first; this
            // statement saw its row, so the next read does too.
            const raced = await findSpecByKey(tx, input);
            if (!raced) throw new Error("The request spec was neither created nor found");
            return replayAcceptance(tx, raced, input);
        }

        const [runRow] = await tx
            .insert(scenarioRuns)
            .values({
                companyId: input.companyId,
                createdByUserId: input.createdByUserId,
                kind: "scenario",
                title: spec.title,
                subject: spec.subject,
                status: "queued",
                agentCount: spec.agents,
                roundCount: spec.rounds,
                seed: spec.seed,
                sources: spec.sources,
                estimate: input.estimate,
                usage: EMPTY_USAGE,
                contractVersion: 2,
                requestSpecId: specRow.id,
                generation: 1,
                contextMode: spec.contextMode,
                flags: input.flags,
            })
            .returning();
        const run = runRow!;

        const plan = buildInitialPlan(spec);
        await tx.insert(scenarioUnits).values(
            plan.map(u => ({
                companyId: input.companyId,
                runId: run.id,
                generation: 1,
                unitKey: u.key,
                kind: u.kind,
                seq: u.seq,
                dependsOn: u.dependsOn,
                input: u.input,
                maxCredits: u.maxCredits,
            }))
        );

        const first = firstFundedUnit(plan);
        if (first) {
            const hold = await credits.reserve(tx, {
                companyId: input.companyId,
                runId: run.id,
                generation: 1,
                unitKey: first.key,
                amount: first.maxCredits,
            });
            if (!hold.ok) throw new InsufficientCreditsError(hold.required, hold.available);
        }

        const [dispatch] = await tx
            .insert(scenarioDispatches)
            .values({
                companyId: input.companyId,
                runId: run.id,
                generation: 1,
                eventId: dispatchEventId(run.id, 1),
                // The app's clock, like every time the claims compare against:
                // a database clock a few ms ahead would make the publish right
                // after commit find it "not due" and leave it to the reconciler.
                nextAttemptAt: new Date(),
            })
            .returning({
                id: scenarioDispatches.id,
                eventId: scenarioDispatches.eventId,
                status: scenarioDispatches.status,
            });
        return {
            created: true,
            run: toRunRecord(run),
            requestSpecId: specRow.id,
            dispatch: dispatch!,
        };
    });
}

// ─── Committed artifacts ─────────────────────────────────────────────────────

function likePrefix(prefix: string): string {
    return `${prefix.replace(/[\\%_]/g, c => `\\${c}`)}%`;
}

/** Committed artifacts of `run` (and its company's graph builds). */
/**
 * Whether a build's owner run is still going. A deleted owner counts as
 * finished (builds outlive runs), so the next run with the key takes over
 * instead of waiting on nobody.
 */
async function ownerLiveOf(
    db: DbClient,
    row: Pick<ScenarioGraphBuildRow, "ownerRunId">
): Promise<boolean> {
    if (row.ownerRunId === null) return false;
    const [owner] = await db
        .select({ status: scenarioRuns.status })
        .from(scenarioRuns)
        .where(eq(scenarioRuns.id, row.ownerRunId))
        .limit(1);
    return Boolean(owner && !TERMINAL_STATUSES.includes(owner.status));
}

export function createArtifactReader(
    run: Pick<ScenarioRunRecord, "id" | "companyId" | "generation">,
    db: DbClient = getDb()
): ArtifactReader {
    const ofRun = <T extends { runId: unknown; generation: unknown }>(t: T) =>
        and(
            eq(t.runId as typeof scenarioUnits.runId, run.id),
            eq(t.generation as typeof scenarioUnits.generation, run.generation)
        );
    const ownerIsLive = (row: Pick<ScenarioGraphBuildRow, "ownerRunId">) => ownerLiveOf(db, row);
    return {
        async unitOutput<T>(key: string) {
            const [row] = await db
                .select({ output: scenarioUnits.output })
                .from(scenarioUnits)
                .where(
                    and(
                        ofRun(scenarioUnits),
                        eq(scenarioUnits.unitKey, key),
                        eq(scenarioUnits.status, "committed")
                    )
                )
                .limit(1);
            return row ? ((row.output ?? undefined) as T | undefined) : undefined;
        },
        async unitOutputs<T>(prefix: string) {
            const rows = await db
                .select({ key: scenarioUnits.unitKey, output: scenarioUnits.output })
                .from(scenarioUnits)
                .where(
                    and(
                        ofRun(scenarioUnits),
                        sql`${scenarioUnits.unitKey} LIKE ${likePrefix(prefix)}`,
                        eq(scenarioUnits.status, "committed")
                    )
                )
                .orderBy(asc(scenarioUnits.unitKey));
            return rows.map(r => ({ key: r.key, output: r.output as T }));
        },
        async sourceManifest() {
            const [row] = await db
                .select({ manifest: scenarioSourceManifests.manifest })
                .from(scenarioSourceManifests)
                .where(ofRun(scenarioSourceManifests))
                .limit(1);
            return row?.manifest;
        },
        async ontologySpec() {
            const [row] = await db
                .select()
                .from(scenarioOntologySpecs)
                .where(eq(scenarioOntologySpecs.runId, run.id))
                .limit(1);
            if (!row) return undefined;
            return {
                id: row.id,
                version: 1 as const,
                schema: row.schema,
                sourceManifestHash: row.sourceManifestHash,
                plannerPromptVersion: row.plannerPromptVersion,
                plannerModel: row.plannerModel,
                validation: row.validation,
                ontologyHash: row.ontologyHash,
            };
        },
        async graphBuild(buildKey) {
            const [row] = await db
                .select()
                .from(scenarioGraphBuilds)
                .where(
                    and(
                        eq(scenarioGraphBuilds.companyId, run.companyId),
                        eq(scenarioGraphBuilds.buildKey, buildKey)
                    )
                )
                .limit(1);
            return row ? toBuild(row, await ownerIsLive(row)) : undefined;
        },
        async graphBuildById(id) {
            const [row] = await db
                .select()
                .from(scenarioGraphBuilds)
                .where(
                    and(
                        eq(scenarioGraphBuilds.companyId, run.companyId),
                        eq(scenarioGraphBuilds.id, id)
                    )
                )
                .limit(1);
            return row ? toBuild(row, await ownerIsLive(row)) : undefined;
        },
        async graphIngestions(buildId) {
            const rows = await db
                .select()
                .from(scenarioGraphIngestions)
                .where(
                    and(
                        eq(scenarioGraphIngestions.companyId, run.companyId),
                        eq(scenarioGraphIngestions.buildId, buildId)
                    )
                )
                .orderBy(asc(scenarioGraphIngestions.unitKey));
            return rows.map(r => ({
                id: r.id,
                buildId: r.buildId,
                unitKey: r.unitKey,
                evidenceIds: r.evidenceIds,
                episodeUuids: r.episodeUuids,
                status: r.status as "pending" | "done" | "failed",
                attempts: r.attempts,
                error: r.error ?? null,
            }));
        },
        async graphSnapshot(buildId) {
            const [row] = await db
                .select()
                .from(scenarioGraphSnapshots)
                .where(
                    and(
                        eq(scenarioGraphSnapshots.companyId, run.companyId),
                        eq(scenarioGraphSnapshots.buildId, buildId)
                    )
                )
                .limit(1);
            return row ? { id: row.id, buildId: row.buildId, data: row.data } : undefined;
        },
        async actorContexts() {
            const rows = await db
                .select({ context: scenarioActorContexts.context })
                .from(scenarioActorContexts)
                .where(ofRun(scenarioActorContexts))
                .orderBy(asc(scenarioActorContexts.slotId));
            return rows.map(r => r.context);
        },
        async worldSpec() {
            const [row] = await db
                .select()
                .from(scenarioWorldSpecs)
                .where(ofRun(scenarioWorldSpecs))
                .limit(1);
            return row ? { id: row.id, spec: row.spec, initialWorld: row.initialWorld } : undefined;
        },
        async checkpoints() {
            const rows = await db
                .select()
                .from(scenarioCheckpoints)
                .where(ofRun(scenarioCheckpoints))
                .orderBy(asc(scenarioCheckpoints.round));
            return rows.map(r => ({
                round: r.round,
                stateHash: r.stateHash,
                engineVersion: r.engineVersion,
                turns: r.turns,
                interventions: r.interventions,
                skipped: r.skipped,
                summary: r.summary,
                degraded: r.degraded,
            }));
        },
        async pendingInjections() {
            return db
                .select({ id: scenarioInjections.id, text: scenarioInjections.text })
                .from(scenarioInjections)
                .where(
                    and(
                        eq(scenarioInjections.runId, run.id),
                        isNull(scenarioInjections.appliedRound)
                    )
                )
                .orderBy(asc(scenarioInjections.id));
        },
    };
}

// ─── The commit transaction's artifact writes ────────────────────────────────

async function lockBuild(tx: Tx, companyId: bigint, buildKey: string) {
    const [row] = await tx
        .select()
        .from(scenarioGraphBuilds)
        .where(
            and(
                eq(scenarioGraphBuilds.companyId, companyId),
                eq(scenarioGraphBuilds.buildKey, buildKey)
            )
        )
        .for("update");
    return row;
}

async function ownedBuild(tx: Tx, run: ScenarioRunRow, buildKey: string) {
    const build = await lockBuild(tx, run.companyId, buildKey);
    if (!build) throw new Refused("graph_build_missing");
    if (build.ownerRunId !== run.id) throw new Refused("graph_build_not_owner");
    return build;
}

/** Apply one write; returns the new world spec id for a `world_spec` write. */
async function applyWrite(
    tx: Tx,
    run: ScenarioRunRow,
    write: ArtifactWrite,
    at: Date
): Promise<number | undefined> {
    const base = { companyId: run.companyId, runId: run.id, generation: run.generation };
    switch (write.type) {
        case "source_manifest":
            await tx.insert(scenarioSourceManifests).values({
                ...base,
                manifest: write.manifest,
                manifestHash: write.manifest.manifestHash,
                documentIds: write.manifest.documentIds,
            });
            return undefined;
        case "ontology_spec": {
            if (!run.requestSpecId) throw new Refused("no_request_spec");
            await tx.insert(scenarioOntologySpecs).values({
                companyId: run.companyId,
                runId: run.id,
                requestSpecId: run.requestSpecId,
                schema: write.spec.schema,
                sourceManifestHash: write.spec.sourceManifestHash,
                plannerPromptVersion: write.spec.plannerPromptVersion,
                plannerModel: write.spec.plannerModel,
                validation: write.spec.validation,
                ontologyHash: write.spec.ontologyHash,
            });
            return undefined;
        }
        case "graph_build": {
            const frozenAt = write.state === "frozen" ? at : null;
            const inserted = await tx
                .insert(scenarioGraphBuilds)
                .values({
                    companyId: run.companyId,
                    buildKey: write.buildKey,
                    groupId: write.groupId,
                    manifestHash: write.manifestHash,
                    ontologyHash: write.ontologyHash,
                    policyVersion: write.policyVersion,
                    state: write.state,
                    ownerRunId: run.id,
                    ownerEpoch: 1,
                    error: write.error ?? null,
                    frozenAt,
                })
                .onConflictDoNothing({
                    target: [scenarioGraphBuilds.companyId, scenarioGraphBuilds.buildKey],
                })
                .returning({ id: scenarioGraphBuilds.id });
            if (inserted.length > 0) return undefined;
            const build = await lockBuild(tx, run.companyId, write.buildKey);
            if (!build) throw new Refused("graph_build_missing");
            const change = {
                state: write.state,
                error: write.error ?? null,
                ...(frozenAt ? { frozenAt } : {}),
            };
            if (build.ownerRunId === run.id) {
                await tx
                    .update(scenarioGraphBuilds)
                    .set(change)
                    .where(eq(scenarioGraphBuilds.id, build.id));
                return undefined;
            }
            if (!write.takeOver) throw new Refused("graph_build_not_owner");
            if (build.ownerRunId !== null) {
                const [owner] = await tx
                    .select({ status: scenarioRuns.status })
                    .from(scenarioRuns)
                    .where(eq(scenarioRuns.id, build.ownerRunId))
                    .limit(1);
                // A deleted owner run cascades nothing here (builds outlive
                // runs), so a missing owner counts as finished.
                if (owner && !TERMINAL_STATUSES.includes(owner.status))
                    throw new Refused("graph_build_owner_live");
            }
            await tx
                .update(scenarioGraphBuilds)
                .set({
                    ...change,
                    groupId: write.groupId,
                    ownerRunId: run.id,
                    ownerEpoch: sql`${scenarioGraphBuilds.ownerEpoch} + 1`,
                })
                .where(eq(scenarioGraphBuilds.id, build.id));
            return undefined;
        }
        case "graph_ingestion": {
            const build = await ownedBuild(tx, run, write.buildKey);
            await tx
                .insert(scenarioGraphIngestions)
                .values({
                    companyId: run.companyId,
                    buildId: build.id,
                    unitKey: write.unitKey,
                    evidenceIds: write.evidenceIds,
                    episodeUuids: write.episodeUuids,
                    status: write.status,
                    error: write.error ?? null,
                    attempts: 1,
                })
                .onConflictDoUpdate({
                    target: [scenarioGraphIngestions.buildId, scenarioGraphIngestions.unitKey],
                    set: {
                        evidenceIds: write.evidenceIds,
                        episodeUuids: write.episodeUuids,
                        status: write.status,
                        error: write.error ?? null,
                        attempts: sql`${scenarioGraphIngestions.attempts} + 1`,
                        updatedAt: at,
                    },
                });
            return undefined;
        }
        case "graph_snapshot": {
            const build = await ownedBuild(tx, run, write.buildKey);
            const [snapshot] = await tx
                .insert(scenarioGraphSnapshots)
                .values({
                    companyId: run.companyId,
                    buildId: build.id,
                    data: write.data,
                    graphHash: write.data.graphHash,
                })
                .returning({ id: scenarioGraphSnapshots.id });
            await tx
                .update(scenarioGraphBuilds)
                .set({ snapshotId: snapshot!.id, state: "frozen", frozenAt: at, error: null })
                .where(eq(scenarioGraphBuilds.id, build.id));
            return undefined;
        }
        case "actor_contexts":
            if (write.contexts.length === 0) return undefined;
            await tx.insert(scenarioActorContexts).values(
                write.contexts.map(context => ({
                    ...base,
                    slotId: context.slotId,
                    context,
                    contextHash: context.contextHash,
                }))
            );
            return undefined;
        case "world_spec": {
            const [row] = await tx
                .insert(scenarioWorldSpecs)
                .values({
                    ...base,
                    spec: write.spec,
                    initialWorld: write.initialWorld,
                    specHash: write.spec.specHash,
                })
                .returning({ id: scenarioWorldSpecs.id });
            return row!.id;
        }
        case "checkpoint": {
            const c = write.checkpoint;
            await tx.insert(scenarioCheckpoints).values({
                ...base,
                round: c.round,
                stateHash: c.stateHash,
                engineVersion: c.engineVersion,
                turns: c.turns,
                interventions: c.interventions,
                skipped: c.skipped,
                summary: c.summary,
                degraded: c.degraded,
            });
            if (write.appliedInjectionIds.length > 0) {
                await tx
                    .update(scenarioInjections)
                    .set({ appliedRound: c.round })
                    .where(
                        and(
                            eq(scenarioInjections.runId, run.id),
                            inArray(scenarioInjections.id, write.appliedInjectionIds),
                            isNull(scenarioInjections.appliedRound)
                        )
                    );
            }
            return undefined;
        }
    }
}

// ─── The store ───────────────────────────────────────────────────────────────

export interface V2StoreOptions {
    credits: ScenarioCreditsPort;
    /** Defaults to the registered client (`getDb()`), read on each call. */
    db?: DbClient;
    log?: (message: string, meta?: Record<string, unknown>) => void;
}

async function lockFenced(
    tx: Tx,
    fence: LeaseFence,
    options: { allowCancelRequested: boolean }
): Promise<ScenarioRunRow | undefined> {
    const conditions = [
        eq(scenarioRuns.id, fence.runId),
        eq(scenarioRuns.leaseOwner, fence.owner),
        eq(scenarioRuns.leaseEpoch, fence.epoch),
        eq(scenarioRuns.generation, fence.generation),
        inArray(scenarioRuns.status, [...ACTIVE]),
    ];
    if (!options.allowCancelRequested) conditions.push(isNull(scenarioRuns.cancelRequestedAt));
    const [row] = await tx
        .select()
        .from(scenarioRuns)
        .where(and(...conditions))
        .for("update");
    return row;
}

const bumpUnknownAttempts = (runId: number, n: number) => sql`
    UPDATE ${scenarioRuns}
    SET flags = jsonb_set(
        coalesce(flags, '{}'::jsonb),
        '{unknownAttempts}',
        to_jsonb(coalesce((flags ->> 'unknownAttempts')::int, 0) + ${n}::int),
        true
    )
    WHERE id = ${runId}
`;

export function createV2Store(options: V2StoreOptions): V2Store {
    const db = () => options.db ?? getDb();
    const { credits } = options;

    return {
        // ── Lease ──
        async claimLease(runId, owner, now, until) {
            const [row] = await db()
                .update(scenarioRuns)
                .set({
                    leaseOwner: owner,
                    leaseEpoch: sql`${scenarioRuns.leaseEpoch} + 1`,
                    leaseUntil: until,
                })
                .where(
                    and(
                        eq(scenarioRuns.id, runId),
                        eq(scenarioRuns.contractVersion, 2),
                        inArray(scenarioRuns.status, [...ACTIVE]),
                        or(isNull(scenarioRuns.leaseUntil), lt(scenarioRuns.leaseUntil, now))
                    )
                )
                .returning({
                    epoch: scenarioRuns.leaseEpoch,
                    generation: scenarioRuns.generation,
                });
            return row ? { runId, owner, epoch: row.epoch, generation: row.generation } : null;
        },
        async renewLease(fence, until) {
            const rows = await db()
                .update(scenarioRuns)
                .set({ leaseUntil: until })
                .where(
                    and(
                        eq(scenarioRuns.id, fence.runId),
                        eq(scenarioRuns.leaseOwner, fence.owner),
                        eq(scenarioRuns.leaseEpoch, fence.epoch),
                        eq(scenarioRuns.generation, fence.generation),
                        inArray(scenarioRuns.status, [...ACTIVE])
                    )
                )
                .returning({ id: scenarioRuns.id });
            return rows.length > 0;
        },
        async releaseLease(fence, until) {
            const rows = await db()
                .update(scenarioRuns)
                .set({ leaseOwner: null, leaseUntil: until })
                .where(
                    and(
                        eq(scenarioRuns.id, fence.runId),
                        eq(scenarioRuns.leaseOwner, fence.owner),
                        eq(scenarioRuns.leaseEpoch, fence.epoch),
                        eq(scenarioRuns.generation, fence.generation)
                    )
                )
                .returning({ id: scenarioRuns.id });
            return rows.length > 0;
        },

        // ── Reads ──
        async getRun(runId) {
            const [row] = await db()
                .select()
                .from(scenarioRuns)
                .where(eq(scenarioRuns.id, runId))
                .limit(1);
            return row ? toRunRecord(row) : undefined;
        },
        async getSpec(requestSpecId) {
            const [row] = await db()
                .select({
                    spec: scenarioRequestSpecs.spec,
                    specHash: scenarioRequestSpecs.specHash,
                })
                .from(scenarioRequestSpecs)
                .where(eq(scenarioRequestSpecs.id, requestSpecId))
                .limit(1);
            return row;
        },
        async listUnits(runId, generation) {
            const rows = await db()
                .select()
                .from(scenarioUnits)
                .where(
                    and(eq(scenarioUnits.runId, runId), eq(scenarioUnits.generation, generation))
                )
                .orderBy(asc(scenarioUnits.seq), asc(scenarioUnits.unitKey));
            return rows.map(toUnit);
        },
        artifacts: run => createArtifactReader(run, db()),

        // ── Unit lifecycle (fenced) ──
        async reserve(fence, request) {
            return db().transaction(async tx => {
                const run = await lockFenced(tx, fence, { allowCancelRequested: true });
                if (!run) return null;
                return credits.reserve(tx, {
                    companyId: request.companyId,
                    runId: fence.runId,
                    generation: fence.generation,
                    unitKey: request.unitKey,
                    amount: request.amount,
                });
            });
        },
        async markUnitStarted(fence, unitId, inputHash, at) {
            return db().transaction(async tx => {
                const run = await lockFenced(tx, fence, { allowCancelRequested: true });
                if (!run) return null;
                const [unit] = await tx
                    .update(scenarioUnits)
                    .set({
                        status: "running",
                        attempts: sql`${scenarioUnits.attempts} + 1`,
                        inputHash,
                        startedAt: at,
                    })
                    .where(
                        and(
                            eq(scenarioUnits.id, unitId),
                            eq(scenarioUnits.runId, fence.runId),
                            eq(scenarioUnits.generation, fence.generation),
                            inArray(scenarioUnits.status, OPEN_UNIT)
                        )
                    )
                    .returning();
                if (!unit) return null;
                await tx
                    .update(scenarioRuns)
                    .set({ status: "running", startedAt: run.startedAt ?? at })
                    .where(eq(scenarioRuns.id, run.id));
                return toUnit(unit);
            });
        },
        async recordUnitError(fence, unitId, error) {
            return db().transaction(async tx => {
                const run = await lockFenced(tx, fence, { allowCancelRequested: true });
                if (!run) return false;
                await tx
                    .update(scenarioUnits)
                    .set({ error })
                    .where(and(eq(scenarioUnits.id, unitId), eq(scenarioUnits.runId, run.id)));
                return true;
            });
        },
        async deferUnit(fence, unitId, wait) {
            return db().transaction(async tx => {
                const run = await lockFenced(tx, fence, { allowCancelRequested: true });
                if (!run) return false;
                await tx
                    .update(scenarioUnits)
                    .set({
                        status: "pending",
                        attempts: sql`greatest(${scenarioUnits.attempts} - 1, 0)`,
                    })
                    .where(
                        and(
                            eq(scenarioUnits.id, unitId),
                            eq(scenarioUnits.runId, run.id),
                            eq(scenarioUnits.status, "running")
                        )
                    );
                const flags = flagsOf(run);
                await tx
                    .update(scenarioRuns)
                    .set({
                        flags: { ...flags, waitingSince: flags.waitingSince ?? wait.waitingSince },
                        leaseOwner: null,
                        leaseUntil: wait.retryAt,
                    })
                    .where(eq(scenarioRuns.id, run.id));
                return true;
            });
        },
        async commitUnit(fence, commit: UnitCommit) {
            try {
                return await db().transaction(async tx => {
                    const run = await lockFenced(tx, fence, { allowCancelRequested: false });
                    if (!run) throw new Refused("fenced_or_cancelled");
                    const at = commit.at;
                    const [unit] = await tx
                        .update(scenarioUnits)
                        .set({
                            status: "committed",
                            output: commit.result.output ?? null,
                            usage: commit.usage,
                            credits: commit.credits,
                            durationMs: Math.round(commit.durationMs),
                            committedAt: at,
                        })
                        .where(
                            and(
                                eq(scenarioUnits.id, commit.unit.id),
                                eq(scenarioUnits.runId, run.id),
                                eq(scenarioUnits.generation, run.generation),
                                inArray(scenarioUnits.status, OPEN_UNIT)
                            )
                        )
                        .returning({ id: scenarioUnits.id });
                    if (!unit) throw new Refused("unit_already_closed");

                    let worldSpecId: number | undefined;
                    for (const write of commit.result.writes ?? []) {
                        const id = await applyWrite(tx, run, write, at);
                        if (id !== undefined) worldSpecId = id;
                    }

                    const followUps = commit.result.followUps ?? [];
                    if (followUps.length > 0) {
                        await tx
                            .insert(scenarioUnits)
                            .values(
                                followUps.map(u => ({
                                    companyId: run.companyId,
                                    runId: run.id,
                                    generation: run.generation,
                                    unitKey: u.key,
                                    kind: u.kind,
                                    seq: u.seq,
                                    dependsOn: u.dependsOn,
                                    input: u.input,
                                    maxCredits: u.maxCredits,
                                }))
                            )
                            .onConflictDoNothing({
                                target: [
                                    scenarioUnits.runId,
                                    scenarioUnits.generation,
                                    scenarioUnits.unitKey,
                                ],
                            });
                    }

                    const patch = commit.result.run ?? {};
                    const current = flagsOf(run);
                    const flags: RunFlagsV2 = {
                        ...current,
                        ...patch.flags,
                        // The journal keeps this count; progress ends a wait.
                        unknownAttempts: current.unknownAttempts,
                        waitingSince: null,
                    };
                    const done = patch.status === "done";
                    await tx
                        .update(scenarioRuns)
                        .set({
                            step: run.step + 1,
                            usage: {
                                calls: run.usage.calls + commit.usage.calls,
                                inputTokens: run.usage.inputTokens + commit.usage.inputTokens,
                                outputTokens: run.usage.outputTokens + commit.usage.outputTokens,
                                credits: run.usage.credits + commit.credits,
                            },
                            flags,
                            status: done ? "done" : "running",
                            startedAt: run.startedAt ?? at,
                            ...(patch.evidence !== undefined ? { evidence: patch.evidence } : {}),
                            ...(patch.brief !== undefined ? { brief: patch.brief } : {}),
                            ...(patch.world !== undefined ? { world: patch.world } : {}),
                            ...(patch.report !== undefined ? { report: patch.report } : {}),
                            ...(worldSpecId !== undefined ? { worldSpecId } : {}),
                            ...(done
                                ? {
                                      finishedAt: patch.finishedAt ?? at,
                                      leaseOwner: null,
                                      leaseUntil: null,
                                  }
                                : patch.finishedAt
                                  ? { finishedAt: patch.finishedAt }
                                  : {}),
                        })
                        .where(eq(scenarioRuns.id, run.id));

                    const settled = await credits.settle(tx, {
                        companyId: run.companyId,
                        runId: run.id,
                        generation: run.generation,
                        unitKey: commit.unit.key,
                        credits: commit.credits,
                        description: commit.settlement.description,
                        metadata: {
                            calls: commit.usage.calls,
                            inputTokens: commit.usage.inputTokens,
                            outputTokens: commit.usage.outputTokens,
                        },
                    });
                    if (!settled.settled) throw new Refused(`settlement_${settled.reason}`);
                    if (done) await credits.releaseRun(tx, run.id);
                    return true;
                });
            } catch (error) {
                options.log?.("scenario v2 commit refused", {
                    runId: fence.runId,
                    unit: commit.unit.key,
                    reason: error instanceof Refused ? error.reason : String(error),
                });
                return false;
            }
        },
        async finishRun(fence, outcome) {
            return db().transaction(async tx => {
                const rows = await tx
                    .update(scenarioRuns)
                    .set({
                        status: outcome.status,
                        error: outcome.error,
                        finishedAt: outcome.at,
                        leaseOwner: null,
                        leaseUntil: null,
                    })
                    .where(
                        and(
                            eq(scenarioRuns.id, fence.runId),
                            eq(scenarioRuns.leaseOwner, fence.owner),
                            eq(scenarioRuns.leaseEpoch, fence.epoch),
                            eq(scenarioRuns.generation, fence.generation),
                            inArray(scenarioRuns.status, [...ACTIVE])
                        )
                    )
                    .returning({ id: scenarioRuns.id });
                if (rows.length === 0) return false;
                if (outcome.failedUnitId !== undefined) {
                    await tx
                        .update(scenarioUnits)
                        .set({ status: "failed" })
                        .where(
                            and(
                                eq(scenarioUnits.id, outcome.failedUnitId),
                                inArray(scenarioUnits.status, OPEN_UNIT)
                            )
                        );
                }
                await credits.releaseRun(tx, fence.runId);
                return true;
            });
        },
        async closeEvents(runId, at) {
            // Takes the run's row lock, like v1: an event insert in flight
            // finishes first (and is read as pending) or sees the window closed.
            await db()
                .update(scenarioRuns)
                .set({
                    eventsClosedAt: sql`coalesce(${scenarioRuns.eventsClosedAt}, ${at.toISOString()}::timestamptz)`,
                })
                .where(eq(scenarioRuns.id, runId));
        },

        // ── Call journal ──
        async openCall(input) {
            await db()
                .insert(scenarioCalls)
                .values({
                    companyId: input.scope.companyId,
                    runId: input.scope.runId,
                    generation: input.scope.generation,
                    unitKey: input.scope.unitKey,
                    logicalKey: input.logicalKey,
                    requestHash: input.requestHash,
                    purpose: input.purpose.slice(0, 24),
                    actorId: input.actorId,
                    round: input.round,
                })
                .onConflictDoNothing({ target: scenarioCalls.logicalKey });
            const [row] = await db()
                .select({
                    callId: scenarioCalls.id,
                    attemptId: scenarioCallAttempts.id,
                    rawText: scenarioCallAttempts.rawText,
                    inputTokens: scenarioCallAttempts.inputTokens,
                    outputTokens: scenarioCallAttempts.outputTokens,
                })
                .from(scenarioCalls)
                .leftJoin(
                    scenarioCallAttempts,
                    eq(scenarioCallAttempts.id, scenarioCalls.acceptedAttemptId)
                )
                .where(eq(scenarioCalls.logicalKey, input.logicalKey))
                .limit(1);
            if (!row) throw new Error("The journal call was neither created nor found");
            // A reply purged by retention cannot be served again; a new attempt runs.
            const accepted: AcceptedReply | null =
                row.attemptId !== null && row.rawText !== null
                    ? {
                          attemptId: row.attemptId,
                          text: row.rawText,
                          inputTokens: row.inputTokens ?? 0,
                          outputTokens: row.outputTokens ?? 0,
                      }
                    : null;
            return { callId: row.callId, accepted };
        },
        async startAttempt(input) {
            // Attempt numbers are dense per call; two workers racing on the same
            // number retry with the next one.
            for (let i = 0; i < 8; i++) {
                const rows = await db().execute<{ id: number; attempt: number }>(sql`
                    INSERT INTO ${scenarioCallAttempts} (company_id, call_id, attempt, status, started_at)
                    SELECT ${input.companyId.toString()}::bigint, ${input.callId}::int,
                           coalesce(max(attempt), 0) + 1, 'started', ${input.at.toISOString()}::timestamptz
                    FROM ${scenarioCallAttempts}
                    WHERE call_id = ${input.callId}
                    ON CONFLICT (call_id, attempt) DO NOTHING
                    RETURNING id, attempt
                `);
                const row = [...rows][0];
                if (row) return { attemptId: Number(row.id), attempt: Number(row.attempt) };
            }
            throw new Error("Could not journal a model call attempt");
        },
        async acceptAttempt(input) {
            return db().transaction(async tx => {
                await tx
                    .update(scenarioCallAttempts)
                    .set({
                        status: "succeeded",
                        rawText: input.text,
                        inputTokens: input.inputTokens,
                        outputTokens: input.outputTokens,
                        latencyMs: Math.round(input.latencyMs),
                        model: input.model,
                        finishedAt: input.at,
                    })
                    .where(eq(scenarioCallAttempts.id, input.attemptId));
                const won = await tx
                    .update(scenarioCalls)
                    .set({ acceptedAttemptId: input.attemptId })
                    .where(
                        and(
                            eq(scenarioCalls.id, input.callId),
                            isNull(scenarioCalls.acceptedAttemptId)
                        )
                    )
                    .returning({ id: scenarioCalls.id });
                if (won.length > 0) {
                    return {
                        attemptId: input.attemptId,
                        text: input.text,
                        inputTokens: input.inputTokens,
                        outputTokens: input.outputTokens,
                    };
                }
                const [first] = await tx
                    .select({
                        attemptId: scenarioCallAttempts.id,
                        rawText: scenarioCallAttempts.rawText,
                        inputTokens: scenarioCallAttempts.inputTokens,
                        outputTokens: scenarioCallAttempts.outputTokens,
                    })
                    .from(scenarioCalls)
                    .innerJoin(
                        scenarioCallAttempts,
                        eq(scenarioCallAttempts.id, scenarioCalls.acceptedAttemptId)
                    )
                    .where(eq(scenarioCalls.id, input.callId))
                    .limit(1);
                if (!first || first.rawText === null) {
                    return {
                        attemptId: input.attemptId,
                        text: input.text,
                        inputTokens: input.inputTokens,
                        outputTokens: input.outputTokens,
                    };
                }
                return {
                    attemptId: first.attemptId,
                    text: first.rawText,
                    inputTokens: first.inputTokens,
                    outputTokens: first.outputTokens,
                };
            });
        },
        async failAttempt(input) {
            await db().transaction(async tx => {
                const rows = await tx
                    .update(scenarioCallAttempts)
                    .set({
                        status: input.status,
                        error: input.error,
                        latencyMs: Math.round(input.latencyMs),
                        finishedAt: input.at,
                    })
                    .where(
                        and(
                            eq(scenarioCallAttempts.id, input.attemptId),
                            eq(scenarioCallAttempts.status, "started")
                        )
                    )
                    .returning({ id: scenarioCallAttempts.id });
                if (rows.length > 0 && input.status === "unknown")
                    await tx.execute(bumpUnknownAttempts(input.runId, 1));
            });
        },
    };
}

// ─── Trace view and authorization reads ──────────────────────────────────────

export interface UnitTrace extends UnitRecord {
    durationMs: number | null;
}

/** A run generation's units in plan order, for the trace view. */
export async function listRunUnits(
    runId: number,
    generation: number,
    db: DbClient = getDb()
): Promise<UnitTrace[]> {
    const rows = await db
        .select()
        .from(scenarioUnits)
        .where(and(eq(scenarioUnits.runId, runId), eq(scenarioUnits.generation, generation)))
        .orderBy(asc(scenarioUnits.seq), asc(scenarioUnits.unitKey));
    return rows.map(row => ({ ...toUnit(row), durationMs: row.durationMs ?? null }));
}

/** Files a reader needs for the run's captured evidence; null before the sources unit commits. */
export async function sourceManifestDocumentIds(
    runId: number,
    generation: number,
    db: DbClient = getDb()
): Promise<number[] | null> {
    const [row] = await db
        .select({ documentIds: scenarioSourceManifests.documentIds })
        .from(scenarioSourceManifests)
        .where(
            and(
                eq(scenarioSourceManifests.runId, runId),
                eq(scenarioSourceManifests.generation, generation)
            )
        )
        .limit(1);
    return row ? row.documentIds : null;
}

// ─── Dispatch outbox and reconciliation ──────────────────────────────────────

export interface DispatchRecord {
    id: number;
    companyId: bigint;
    runId: number;
    generation: number;
    eventId: string;
    status: string;
    attempts: number;
}

interface RawDispatch extends Record<string, unknown> {
    id: number | string;
    company_id: number | string | bigint;
    run_id: number | string;
    generation: number | string;
    event_id: string;
    status: string;
    attempts: number | string;
}

function mapRawDispatch(row: RawDispatch): DispatchRecord {
    return {
        id: Number(row.id),
        companyId: BigInt(row.company_id),
        runId: Number(row.run_id),
        generation: Number(row.generation),
        eventId: row.event_id,
        status: row.status,
        attempts: Number(row.attempts),
    };
}

/** How long a claimed dispatch stays invisible to other claimers before it is due again. */
export const DISPATCH_CLAIM_MS = 2 * 60_000;
const DISPATCH_BACKOFF_BASE_MS = 5_000;
const DISPATCH_BACKOFF_MAX_MS = 15 * 60_000;

/** Delay before a failed send is due again: 5 s, 10 s, 20 s … 15 min. */
export function dispatchBackoffMs(attempts: number): number {
    return Math.min(
        DISPATCH_BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1),
        DISPATCH_BACKOFF_MAX_MS
    );
}

/**
 * Claim due dispatches. One statement with `FOR UPDATE SKIP LOCKED`, so
 * concurrent reconcilers take different rows; a claim pushes the row's
 * `next_attempt_at` out, so a claimer that dies leaves it due again later.
 */
export async function claimDueDispatches(
    args: { now: Date; limit?: number; claimMs?: number },
    db: DbClient = getDb()
): Promise<DispatchRecord[]> {
    const now = args.now.toISOString();
    const until = new Date(args.now.getTime() + (args.claimMs ?? DISPATCH_CLAIM_MS)).toISOString();
    const rows = await db.execute<RawDispatch>(sql`
        WITH due AS (
            SELECT id FROM ${scenarioDispatches}
            WHERE status = 'pending' AND next_attempt_at <= ${now}::timestamptz
            ORDER BY next_attempt_at ASC, id ASC
            LIMIT ${args.limit ?? 20}
            FOR UPDATE SKIP LOCKED
        )
        UPDATE ${scenarioDispatches} AS d
        SET attempts = d.attempts + 1, next_attempt_at = ${until}::timestamptz
        FROM due
        WHERE d.id = due.id
        RETURNING d.id, d.company_id, d.run_id, d.generation, d.event_id, d.status, d.attempts
    `);
    return [...rows].map(mapRawDispatch);
}

/** Claim one dispatch (the publish right after acceptance); null when it is not pending and due. */
export async function claimDispatch(
    id: number,
    args: { now: Date; claimMs?: number },
    db: DbClient = getDb()
): Promise<DispatchRecord | null> {
    const until = new Date(args.now.getTime() + (args.claimMs ?? DISPATCH_CLAIM_MS)).toISOString();
    const rows = await db.execute<RawDispatch>(sql`
        WITH one AS (
            SELECT id FROM ${scenarioDispatches}
            WHERE id = ${id} AND status = 'pending' AND next_attempt_at <= ${args.now.toISOString()}::timestamptz
            FOR UPDATE SKIP LOCKED
        )
        UPDATE ${scenarioDispatches} AS d
        SET attempts = d.attempts + 1, next_attempt_at = ${until}::timestamptz
        FROM one
        WHERE d.id = one.id
        RETURNING d.id, d.company_id, d.run_id, d.generation, d.event_id, d.status, d.attempts
    `);
    const row = [...rows][0];
    return row ? mapRawDispatch(row) : null;
}

export async function markDispatchSent(
    id: number,
    at: Date,
    db: DbClient = getDb()
): Promise<void> {
    await db
        .update(scenarioDispatches)
        .set({ status: "sent", sentAt: at, lastError: null })
        .where(eq(scenarioDispatches.id, id));
}

/** A failed send goes back to pending after a backoff; the run is never given up on here. */
export async function markDispatchFailed(
    dispatch: Pick<DispatchRecord, "id" | "attempts">,
    error: string,
    now: Date,
    db: DbClient = getDb()
): Promise<Date> {
    const next = new Date(now.getTime() + dispatchBackoffMs(dispatch.attempts));
    await db
        .update(scenarioDispatches)
        .set({ status: "pending", lastError: error.slice(0, 500), nextAttemptAt: next })
        .where(eq(scenarioDispatches.id, dispatch.id));
    return next;
}

export interface StalledRuns {
    /** New dispatch rows to deliver. */
    dispatched: DispatchRecord[];
    /** Runs re-dispatched too often; the caller fails them under a fresh lease. */
    overCap: number[];
}

/**
 * Re-dispatch v2 runs that nothing is driving: active, lease free (none, or
 * lapsed), untouched for `graceMs`, with no pending dispatch and none sent in
 * the last `quietMs` (a delivery may be queued behind concurrency limits).
 * Each gets a new deterministic event id, `…:r<n>`.
 */
export async function redispatchStalledRuns(
    args: {
        now: Date;
        graceMs?: number;
        quietMs?: number;
        maxRedispatches?: number;
        limit?: number;
    },
    db: DbClient = getDb()
): Promise<StalledRuns> {
    const now = args.now.toISOString();
    const quiet = new Date(args.now.getTime() - (args.quietMs ?? 10 * 60_000)).toISOString();
    const grace = new Date(args.now.getTime() - (args.graceMs ?? 2 * 60_000)).toISOString();
    const rows = await db.execute<{
        id: number | string;
        company_id: number | string | bigint;
        generation: number | string;
        n: number | string;
    }>(sql`
        SELECT r.id, r.company_id, r.generation,
               (SELECT count(*) FROM ${scenarioDispatches} d
                 WHERE d.run_id = r.id AND d.generation = r.generation) AS n
        FROM ${scenarioRuns} r
        WHERE r.contract_version = 2
          AND r.status IN ('queued', 'running')
          AND (r.lease_until IS NULL OR r.lease_until < ${now}::timestamptz)
          AND coalesce(r.updated_at, r.created_at) < ${grace}::timestamptz
          AND NOT EXISTS (
              SELECT 1 FROM ${scenarioDispatches} d
              WHERE d.run_id = r.id AND d.generation = r.generation
                AND (d.status = 'pending' OR (d.status = 'sent' AND d.sent_at > ${quiet}::timestamptz))
          )
        ORDER BY r.id
        LIMIT ${args.limit ?? 50}
    `);
    const dispatched: DispatchRecord[] = [];
    const overCap: number[] = [];
    for (const row of [...rows]) {
        const runId = Number(row.id);
        const generation = Number(row.generation);
        const n = Number(row.n);
        if (n > (args.maxRedispatches ?? 50)) {
            overCap.push(runId);
            continue;
        }
        const [inserted] = await db
            .insert(scenarioDispatches)
            .values({
                companyId: BigInt(row.company_id),
                runId,
                generation,
                eventId: dispatchEventId(runId, generation, Math.max(1, n)),
                nextAttemptAt: args.now,
            })
            .onConflictDoNothing({ target: scenarioDispatches.eventId })
            .returning();
        if (inserted) {
            dispatched.push({
                id: inserted.id,
                companyId: inserted.companyId,
                runId: inserted.runId,
                generation: inserted.generation,
                eventId: inserted.eventId,
                status: inserted.status,
                attempts: inserted.attempts,
            });
        }
    }
    return { dispatched, overCap };
}

/** Holds a finished run still has (a worker died between its terminal write and the release). */
export async function releaseTerminalHolds(at: Date, db: DbClient = getDb()): Promise<number> {
    const rows = await db
        .update(scenarioCreditReservations)
        .set({ status: "released", closedAt: at })
        .where(
            and(
                eq(scenarioCreditReservations.status, "held"),
                inArray(
                    scenarioCreditReservations.runId,
                    db
                        .select({ id: scenarioRuns.id })
                        .from(scenarioRuns)
                        .where(inArray(scenarioRuns.status, [...TERMINAL_STATUSES]))
                )
            )
        )
        .returning({ id: scenarioCreditReservations.id });
    return rows.length;
}

/** Drop raw replies older than the retention window; replay then reads checkpoints. */
export async function purgeRawReplies(before: Date, db: DbClient = getDb()): Promise<number> {
    const rows = await db
        .update(scenarioCallAttempts)
        .set({ rawText: null })
        .where(
            and(lt(scenarioCallAttempts.startedAt, before), isNotNull(scenarioCallAttempts.rawText))
        )
        .returning({ id: scenarioCallAttempts.id });
    return rows.length;
}

/**
 * Attempts still `started` long after any provider timeout: their worker
 * died mid-call, so whether the provider did (and billed) the work is unknown.
 */
export async function markAbandonedAttempts(
    before: Date,
    at: Date,
    db: DbClient = getDb()
): Promise<number> {
    return db.transaction(async tx => {
        const stale = await tx
            .update(scenarioCallAttempts)
            .set({
                status: "unknown",
                error: "No reply was recorded; the worker stopped mid-call.",
                finishedAt: at,
            })
            .where(
                and(
                    eq(scenarioCallAttempts.status, "started"),
                    lt(scenarioCallAttempts.startedAt, before)
                )
            )
            .returning({ callId: scenarioCallAttempts.callId });
        if (stale.length === 0) return 0;
        const calls = await tx
            .select({ id: scenarioCalls.id, runId: scenarioCalls.runId })
            .from(scenarioCalls)
            .where(
                inArray(
                    scenarioCalls.id,
                    stale.map(s => s.callId)
                )
            );
        const runOf = new Map(calls.map(c => [c.id, c.runId]));
        const perRun = new Map<number, number>();
        for (const s of stale) {
            const runId = runOf.get(s.callId);
            if (runId !== undefined) perRun.set(runId, (perRun.get(runId) ?? 0) + 1);
        }
        for (const [runId, n] of perRun) await tx.execute(bumpUnknownAttempts(runId, n));
        return stale.length;
    });
}

// ─── Source deletion ─────────────────────────────────────────────────────────

/**
 * Graph builds made from a file that has since been deleted. Their Neo4j
 * group and frozen snapshot hold facts extracted from that file, so they go
 * too (design §3.3.5: retention and deletion track both stores).
 */
export async function buildsWithDeletedSources(
    limit = 20,
    db: DbClient = getDb()
): Promise<Array<{ id: number; groupId: string }>> {
    const rows = await db.execute(sql`
        select b.id, b.group_id
        from ${scenarioGraphBuilds} b
        where b.deleted_at is null
          and exists (
            select 1
            from ${scenarioSourceManifests} m,
                 jsonb_array_elements_text(m.document_ids) as d(id)
            where m.company_id = b.company_id
              and m.manifest_hash = b.manifest_hash
              and not exists (select 1 from ${document} doc where doc.id = d.id::bigint)
          )
        order by b.id
        limit ${limit}
    `);
    return toRows<{ id: number; group_id: string }>(rows).map(r => ({
        id: Number(r.id),
        groupId: r.group_id,
    }));
}

/** After its Neo4j group is gone: drop the snapshot and mark the build deleted (never reused). */
export async function markGraphBuildDeleted(
    buildId: number,
    at: Date,
    db: DbClient = getDb()
): Promise<void> {
    await db.transaction(async tx => {
        await tx.delete(scenarioGraphSnapshots).where(eq(scenarioGraphSnapshots.buildId, buildId));
        await tx
            .update(scenarioGraphBuilds)
            .set({ deletedAt: at, snapshotId: null, state: "failed", error: "source_deleted" })
            .where(eq(scenarioGraphBuilds.id, buildId));
    });
}
