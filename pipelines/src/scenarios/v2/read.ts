/**
 * Read-only queries over a v2 run's artifacts, for the API (provenance,
 * trace, replay, detail flags). The engine's writes live in store.ts; nothing
 * here mutates. Callers authorize first: every function takes a run the
 * service already resolved for the reader.
 */
import { and, asc, count, eq, gt, inArray, sql } from "drizzle-orm";

import { getDb } from "@launchstack/store/client";

import {
    scenarioActorContexts,
    scenarioCallAttempts,
    scenarioCalls,
    scenarioCheckpoints,
    scenarioGraphBuilds,
    scenarioGraphSnapshots,
    scenarioOntologySpecs,
    scenarioRequestSpecs,
    scenarioSourceManifests,
    scenarioUnits,
    scenarioWorldSpecs,
} from "../schema";
import type {
    ActorContext,
    AttemptStatus,
    GraphSnapshotData,
    OntologySpec,
    RequestSpecV2,
    RoundCheckpoint,
    SourceManifest,
    UnitKind,
    UnitStatus,
    WorldSpecV2,
} from "./contracts";

interface RunRef {
    id: number;
    generation: number;
}

export async function readRequestSpec(
    id: number
): Promise<{ spec: RequestSpecV2; specHash: string } | undefined> {
    const [row] = await getDb()
        .select({ spec: scenarioRequestSpecs.spec, specHash: scenarioRequestSpecs.specHash })
        .from(scenarioRequestSpecs)
        .where(eq(scenarioRequestSpecs.id, id))
        .limit(1);
    return row;
}

export async function readManifest(run: RunRef): Promise<SourceManifest | undefined> {
    const [row] = await getDb()
        .select({ manifest: scenarioSourceManifests.manifest })
        .from(scenarioSourceManifests)
        .where(
            and(
                eq(scenarioSourceManifests.runId, run.id),
                eq(scenarioSourceManifests.generation, run.generation)
            )
        )
        .limit(1);
    return row?.manifest;
}

export async function readOntology(runId: number): Promise<OntologySpec | undefined> {
    const [row] = await getDb()
        .select()
        .from(scenarioOntologySpecs)
        .where(eq(scenarioOntologySpecs.runId, runId))
        .limit(1);
    if (!row) return undefined;
    return {
        version: 1,
        schema: row.schema,
        sourceManifestHash: row.sourceManifestHash,
        plannerPromptVersion: row.plannerPromptVersion,
        plannerModel: row.plannerModel,
        validation: row.validation,
        ontologyHash: row.ontologyHash,
    };
}

/** Committed outputs of a run's units whose key starts with `prefix`, in key order. */
export async function readUnitOutputs<T>(
    run: RunRef,
    prefix: string
): Promise<Array<{ key: string; output: T }>> {
    const rows = await getDb()
        .select({ key: scenarioUnits.unitKey, output: scenarioUnits.output })
        .from(scenarioUnits)
        .where(
            and(
                eq(scenarioUnits.runId, run.id),
                eq(scenarioUnits.generation, run.generation),
                eq(scenarioUnits.status, "committed"),
                sql`${scenarioUnits.unitKey} like ${`${prefix}%`}`
            )
        )
        .orderBy(asc(scenarioUnits.unitKey));
    return rows.map(r => ({ key: r.key, output: r.output as T }));
}

export async function readActorContexts(run: RunRef): Promise<ActorContext[]> {
    const rows = await getDb()
        .select({ context: scenarioActorContexts.context })
        .from(scenarioActorContexts)
        .where(
            and(
                eq(scenarioActorContexts.runId, run.id),
                eq(scenarioActorContexts.generation, run.generation)
            )
        )
        .orderBy(asc(scenarioActorContexts.slotId));
    return rows.map(r => r.context);
}

/** The frozen graph a run's actors were grounded in, if any. */
export async function readGraphSnapshot(
    snapshotId: number,
    companyId: bigint
): Promise<
    | { id: number; groupId: string; buildKey: string; data: GraphSnapshotData; graphHash: string }
    | undefined
> {
    const [row] = await getDb()
        .select({
            id: scenarioGraphSnapshots.id,
            data: scenarioGraphSnapshots.data,
            graphHash: scenarioGraphSnapshots.graphHash,
            groupId: scenarioGraphBuilds.groupId,
            buildKey: scenarioGraphBuilds.buildKey,
        })
        .from(scenarioGraphSnapshots)
        .innerJoin(scenarioGraphBuilds, eq(scenarioGraphBuilds.id, scenarioGraphSnapshots.buildId))
        .where(
            and(
                eq(scenarioGraphSnapshots.id, snapshotId),
                eq(scenarioGraphSnapshots.companyId, companyId)
            )
        )
        .limit(1);
    return row;
}

export async function readWorldSpec(
    run: RunRef
): Promise<{ id: number; spec: WorldSpecV2; specHash: string } | undefined> {
    const [row] = await getDb()
        .select({
            id: scenarioWorldSpecs.id,
            spec: scenarioWorldSpecs.spec,
            specHash: scenarioWorldSpecs.specHash,
        })
        .from(scenarioWorldSpecs)
        .where(
            and(
                eq(scenarioWorldSpecs.runId, run.id),
                eq(scenarioWorldSpecs.generation, run.generation)
            )
        )
        .limit(1);
    return row;
}

/** The world spec with its starting world, for replay. */
export async function readWorldSpecWithWorld(run: RunRef) {
    const [row] = await getDb()
        .select()
        .from(scenarioWorldSpecs)
        .where(
            and(
                eq(scenarioWorldSpecs.runId, run.id),
                eq(scenarioWorldSpecs.generation, run.generation)
            )
        )
        .limit(1);
    return row ? { id: row.id, spec: row.spec, initialWorld: row.initialWorld } : undefined;
}

export async function readCheckpoints(run: RunRef): Promise<RoundCheckpoint[]> {
    const rows = await getDb()
        .select()
        .from(scenarioCheckpoints)
        .where(
            and(
                eq(scenarioCheckpoints.runId, run.id),
                eq(scenarioCheckpoints.generation, run.generation)
            )
        )
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
}

export interface UnitTraceRow {
    seq: number;
    key: string;
    kind: UnitKind;
    status: UnitStatus;
    attempts: number;
    credits: number;
    durationMs: number | null;
    error: string | null;
    startedAt: Date | null;
    committedAt: Date | null;
    calls: number;
    attemptsByStatus: Record<AttemptStatus, number>;
}

/** The run's units in order, after `afterSeq`, with their call attempt counts. */
export async function readTrace(
    run: RunRef,
    page: { afterSeq: number; limit: number }
): Promise<UnitTraceRow[]> {
    const units = await getDb()
        .select({
            seq: scenarioUnits.seq,
            key: scenarioUnits.unitKey,
            kind: scenarioUnits.kind,
            status: scenarioUnits.status,
            attempts: scenarioUnits.attempts,
            credits: scenarioUnits.credits,
            durationMs: scenarioUnits.durationMs,
            error: scenarioUnits.error,
            startedAt: scenarioUnits.startedAt,
            committedAt: scenarioUnits.committedAt,
        })
        .from(scenarioUnits)
        .where(
            and(
                eq(scenarioUnits.runId, run.id),
                eq(scenarioUnits.generation, run.generation),
                gt(scenarioUnits.seq, page.afterSeq)
            )
        )
        .orderBy(asc(scenarioUnits.seq))
        .limit(page.limit);
    if (units.length === 0) return [];
    const stats = await getDb()
        .select({
            unitKey: scenarioCalls.unitKey,
            status: scenarioCallAttempts.status,
            n: count(),
            calls: sql<number>`count(distinct ${scenarioCalls.id})`.mapWith(Number),
        })
        .from(scenarioCallAttempts)
        .innerJoin(scenarioCalls, eq(scenarioCalls.id, scenarioCallAttempts.callId))
        .where(
            and(
                eq(scenarioCalls.runId, run.id),
                eq(scenarioCalls.generation, run.generation),
                inArray(
                    scenarioCalls.unitKey,
                    units.map(u => u.key)
                )
            )
        )
        .groupBy(scenarioCalls.unitKey, scenarioCallAttempts.status);
    const empty = (): Record<AttemptStatus, number> => ({
        started: 0,
        succeeded: 0,
        failed: 0,
        unknown: 0,
    });
    const byUnit = new Map<string, { calls: number; by: Record<AttemptStatus, number> }>();
    for (const s of stats) {
        const entry = byUnit.get(s.unitKey) ?? { calls: 0, by: empty() };
        entry.by[s.status as AttemptStatus] = Number(s.n);
        entry.calls = Math.max(entry.calls, s.calls);
        byUnit.set(s.unitKey, entry);
    }
    return units.map(u => ({
        ...u,
        kind: u.kind,
        status: u.status,
        calls: byUnit.get(u.key)?.calls ?? 0,
        attemptsByStatus: byUnit.get(u.key)?.by ?? empty(),
    }));
}

/** Physical model attempts of the run by outcome: the "known/unknown attempts" a v2 detail shows. */
export async function readAttemptCounts(run: RunRef): Promise<Record<AttemptStatus, number>> {
    const rows = await getDb()
        .select({ status: scenarioCallAttempts.status, n: count() })
        .from(scenarioCallAttempts)
        .innerJoin(scenarioCalls, eq(scenarioCalls.id, scenarioCallAttempts.callId))
        .where(and(eq(scenarioCalls.runId, run.id), eq(scenarioCalls.generation, run.generation)))
        .groupBy(scenarioCallAttempts.status);
    const out: Record<AttemptStatus, number> = { started: 0, succeeded: 0, failed: 0, unknown: 0 };
    for (const r of rows) out[r.status as AttemptStatus] = Number(r.n);
    return out;
}

/** The kind of each v2 run's next unfinished unit, for list and progress labels. */
export async function readNextUnitKinds(
    runs: Array<{ id: number; generation: number }>
): Promise<Map<number, UnitKind | null>> {
    const out = new Map<number, UnitKind | null>();
    if (runs.length === 0) return out;
    const rows = await getDb()
        .selectDistinctOn([scenarioUnits.runId], {
            runId: scenarioUnits.runId,
            generation: scenarioUnits.generation,
            kind: scenarioUnits.kind,
        })
        .from(scenarioUnits)
        .where(
            and(
                inArray(
                    scenarioUnits.runId,
                    runs.map(r => r.id)
                ),
                sql`${scenarioUnits.status} <> 'committed'`
            )
        )
        .orderBy(scenarioUnits.runId, asc(scenarioUnits.seq));
    const generation = new Map(runs.map(r => [r.id, r.generation]));
    for (const r of runs) out.set(r.id, null);
    for (const row of rows) {
        if (generation.get(row.runId) === row.generation) out.set(row.runId, row.kind);
    }
    return out;
}
