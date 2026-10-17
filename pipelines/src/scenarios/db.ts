/**
 * Persistence for the scenarios vertical. Reads that serve a person are
 * scoped by company_id; the run loop reads by run id because the run row
 * carries the workspace the route resolved.
 */
import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";

import { getDb } from "@launchstack/store/client";

import type { RunPatch, ScenarioStore } from "./run";
import {
    scenarioInjections,
    scenarioInterviews,
    scenarioPostLinks,
    scenarioRuns,
    type ScenarioInjectionRow,
    type ScenarioInterviewRow,
    type ScenarioRunRow,
} from "./schema";
import type {
    PostTestDraft,
    RunEstimateStored,
    ScenarioKind,
    ScenarioRunRecord,
    ScenarioSourcesInput,
} from "./types";
import { EMPTY_USAGE } from "./types";

function toRecord(row: ScenarioRunRow): ScenarioRunRecord {
    return {
        id: row.id,
        companyId: row.companyId,
        createdByUserId: row.createdByUserId,
        kind: row.kind,
        title: row.title,
        subject: row.subject,
        status: row.status,
        step: row.step,
        agentCount: row.agentCount,
        roundCount: row.roundCount,
        seed: row.seed,
        sources: row.sources,
        evidence: row.evidence ?? null,
        brief: row.brief ?? null,
        world: row.world ?? null,
        report: row.report ?? null,
        reception: row.reception ?? null,
        estimate: row.estimate,
        usage: row.usage,
        draft: row.draft ?? null,
        draftHash: row.draftHash ?? null,
        error: row.error ?? null,
        sharedAt: row.sharedAt ?? null,
        cancelRequestedAt: row.cancelRequestedAt ?? null,
        leaseUntil: row.leaseUntil ?? null,
        createdAt: row.createdAt,
        startedAt: row.startedAt ?? null,
        finishedAt: row.finishedAt ?? null,
    };
}

export interface CreateRunInput {
    companyId: bigint;
    createdByUserId: string;
    kind: ScenarioKind;
    title: string;
    subject: string;
    agentCount: number;
    roundCount: number;
    seed: number;
    sources: ScenarioSourcesInput;
    estimate: RunEstimateStored;
    draft?: PostTestDraft;
    draftHash?: string;
}

export async function createScenarioRun(input: CreateRunInput): Promise<ScenarioRunRecord> {
    const [row] = await getDb()
        .insert(scenarioRuns)
        .values({
            companyId: input.companyId,
            createdByUserId: input.createdByUserId,
            kind: input.kind,
            title: input.title,
            subject: input.subject,
            agentCount: input.agentCount,
            roundCount: input.roundCount,
            seed: input.seed,
            sources: input.sources,
            estimate: input.estimate,
            usage: EMPTY_USAGE,
            draft: input.draft ?? null,
            draftHash: input.draftHash ?? null,
        })
        .returning();
    return toRecord(row!);
}

export async function getRunById(id: number): Promise<ScenarioRunRecord | undefined> {
    const [row] = await getDb().select().from(scenarioRuns).where(eq(scenarioRuns.id, id)).limit(1);
    return row ? toRecord(row) : undefined;
}

export async function getCompanyRun(
    companyId: bigint,
    id: number
): Promise<ScenarioRunRecord | undefined> {
    const [row] = await getDb()
        .select()
        .from(scenarioRuns)
        .where(and(eq(scenarioRuns.id, id), eq(scenarioRuns.companyId, companyId)))
        .limit(1);
    return row ? toRecord(row) : undefined;
}

/** Light rows for lists: no world, evidence or brief. */
export interface RunListRow {
    id: number;
    kind: ScenarioKind;
    title: string;
    subject: string;
    status: ScenarioRunRecord["status"];
    step: number;
    agentCount: number;
    roundCount: number;
    createdByUserId: string;
    sharedAt: Date | null;
    createdAt: Date;
    finishedAt: Date | null;
    headline: string | null;
}

/** Runs the viewer made, plus runs shared with the workspace. */
export async function listVisibleRuns(args: {
    companyId: bigint;
    viewerUserId: string;
    kind: ScenarioKind;
    limit?: number;
}): Promise<RunListRow[]> {
    const rows = await getDb()
        .select({
            id: scenarioRuns.id,
            kind: scenarioRuns.kind,
            title: scenarioRuns.title,
            subject: scenarioRuns.subject,
            status: scenarioRuns.status,
            step: scenarioRuns.step,
            agentCount: scenarioRuns.agentCount,
            roundCount: scenarioRuns.roundCount,
            createdByUserId: scenarioRuns.createdByUserId,
            sharedAt: scenarioRuns.sharedAt,
            createdAt: scenarioRuns.createdAt,
            finishedAt: scenarioRuns.finishedAt,
            headline: sql<string | null>`${scenarioRuns.report} ->> 'headline'`,
        })
        .from(scenarioRuns)
        .where(
            and(
                eq(scenarioRuns.companyId, args.companyId),
                eq(scenarioRuns.kind, args.kind),
                or(
                    eq(scenarioRuns.createdByUserId, args.viewerUserId),
                    isNotNull(scenarioRuns.sharedAt)
                )
            )
        )
        .orderBy(desc(scenarioRuns.createdAt))
        .limit(args.limit ?? 100);
    return rows.map(r => ({
        ...r,
        sharedAt: r.sharedAt ?? null,
        finishedAt: r.finishedAt ?? null,
    }));
}

export async function updateRunMeta(
    companyId: bigint,
    id: number,
    patch: { title?: string; shared?: boolean },
    now: Date
): Promise<void> {
    const set: Partial<typeof scenarioRuns.$inferInsert> = {};
    if (patch.title !== undefined) set.title = patch.title;
    if (patch.shared !== undefined) set.sharedAt = patch.shared ? now : null;
    if (Object.keys(set).length === 0) return;
    await getDb()
        .update(scenarioRuns)
        .set(set)
        .where(and(eq(scenarioRuns.id, id), eq(scenarioRuns.companyId, companyId)));
}

export async function deleteRun(companyId: bigint, id: number): Promise<void> {
    await getDb()
        .delete(scenarioRuns)
        .where(and(eq(scenarioRuns.id, id), eq(scenarioRuns.companyId, companyId)));
}

/** Ask a run to stop; a queued run that no executor holds stops at once. */
export async function requestCancel(companyId: bigint, id: number, now: Date): Promise<void> {
    await getDb()
        .update(scenarioRuns)
        .set({ cancelRequestedAt: now })
        .where(
            and(
                eq(scenarioRuns.id, id),
                eq(scenarioRuns.companyId, companyId),
                inArray(scenarioRuns.status, ["queued", "running"])
            )
        );
}

/** Claim the in-process lease; false when another process holds a live one. */
export async function claimLease(id: number, now: Date, until: Date): Promise<boolean> {
    const rows = await getDb()
        .update(scenarioRuns)
        .set({ leaseUntil: until })
        .where(
            and(
                eq(scenarioRuns.id, id),
                inArray(scenarioRuns.status, ["queued", "running"]),
                or(isNull(scenarioRuns.leaseUntil), lt(scenarioRuns.leaseUntil, now))
            )
        )
        .returning({ id: scenarioRuns.id });
    return rows.length > 0;
}

export async function renewLease(id: number, until: Date): Promise<void> {
    await getDb().update(scenarioRuns).set({ leaseUntil: until }).where(eq(scenarioRuns.id, id));
}

export async function releaseLease(id: number): Promise<void> {
    await getDb().update(scenarioRuns).set({ leaseUntil: null }).where(eq(scenarioRuns.id, id));
}

export function createScenarioStore(): ScenarioStore {
    return {
        get: getRunById,
        async commitUnit(runId, expectedStep, patch: RunPatch, applied) {
            return getDb().transaction(async tx => {
                const rows = await tx
                    .update(scenarioRuns)
                    .set({ ...patch, step: expectedStep + 1 })
                    .where(
                        and(
                            eq(scenarioRuns.id, runId),
                            eq(scenarioRuns.step, expectedStep),
                            inArray(scenarioRuns.status, ["queued", "running"])
                        )
                    )
                    .returning({ id: scenarioRuns.id });
                if (rows.length === 0) return false;
                if (applied && applied.injectionIds.length > 0) {
                    await tx
                        .update(scenarioInjections)
                        .set({ appliedRound: applied.round })
                        .where(
                            and(
                                eq(scenarioInjections.runId, runId),
                                inArray(scenarioInjections.id, applied.injectionIds),
                                isNull(scenarioInjections.appliedRound)
                            )
                        );
                }
                return true;
            });
        },
        async finish(runId, status, error, at) {
            const rows = await getDb()
                .update(scenarioRuns)
                .set({ status, error, finishedAt: at, leaseUntil: null })
                .where(
                    and(
                        eq(scenarioRuns.id, runId),
                        inArray(scenarioRuns.status, ["queued", "running"])
                    )
                )
                .returning({ id: scenarioRuns.id });
            return rows.length > 0;
        },
        async markStarted(runId, at) {
            await getDb()
                .update(scenarioRuns)
                .set({ status: "running", startedAt: at })
                .where(and(eq(scenarioRuns.id, runId), eq(scenarioRuns.status, "queued")));
        },
        async pendingInjections(runId) {
            return getDb()
                .select({ id: scenarioInjections.id, text: scenarioInjections.text })
                .from(scenarioInjections)
                .where(
                    and(
                        eq(scenarioInjections.runId, runId),
                        isNull(scenarioInjections.appliedRound)
                    )
                )
                .orderBy(asc(scenarioInjections.id));
        },
    };
}

// ─── Injections and interviews ───────────────────────────────────────────────

export async function addInjection(args: {
    companyId: bigint;
    runId: number;
    createdByUserId: string;
    text: string;
}): Promise<ScenarioInjectionRow> {
    const [row] = await getDb().insert(scenarioInjections).values(args).returning();
    return row!;
}

export async function listInjections(runId: number): Promise<ScenarioInjectionRow[]> {
    return getDb()
        .select()
        .from(scenarioInjections)
        .where(eq(scenarioInjections.runId, runId))
        .orderBy(asc(scenarioInjections.id));
}

export async function addInterview(args: {
    companyId: bigint;
    runId: number;
    askedByUserId: string;
    agentId: string;
    question: string;
    answer: string;
}): Promise<ScenarioInterviewRow> {
    const [row] = await getDb().insert(scenarioInterviews).values(args).returning();
    return row!;
}

export async function listInterviews(
    runId: number,
    askedByUserId: string
): Promise<ScenarioInterviewRow[]> {
    return getDb()
        .select()
        .from(scenarioInterviews)
        .where(
            and(
                eq(scenarioInterviews.runId, runId),
                eq(scenarioInterviews.askedByUserId, askedByUserId)
            )
        )
        .orderBy(asc(scenarioInterviews.id));
}

// ─── Post tests ──────────────────────────────────────────────────────────────

/** Point each post at this test (a re-test of the same post replaces the old link). */
export async function linkPostTest(
    companyId: bigint,
    runId: number,
    brandPostIds: string[]
): Promise<void> {
    if (brandPostIds.length === 0) return;
    await getDb()
        .insert(scenarioPostLinks)
        .values(brandPostIds.map(brandPostId => ({ companyId, runId, brandPostId })))
        .onConflictDoUpdate({
            target: scenarioPostLinks.brandPostId,
            set: { runId, createdAt: sql`CURRENT_TIMESTAMP` },
        });
}
