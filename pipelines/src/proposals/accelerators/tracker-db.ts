import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { getDb, type DbClient } from "@launchstack/store/client";

import {
    acceleratorTrackerOpportunities as opportunities,
    acceleratorTrackerTasks as tasks,
} from "./schema";
import {
    assertTrackerCycleChange,
    selectTrackerOpportunity,
    trackerCompletionTime,
    type CreateTrackerTask,
    type SaveTrackerOpportunity,
    type TrackerOpportunity,
    type TrackerTask,
    type UpdateTrackerOpportunity,
    type UpdateTrackerTask,
} from "./tracker";
import { AcceleratorError } from "./types";

type OpportunityRow = typeof opportunities.$inferSelect;
type TaskRow = typeof tasks.$inferSelect;
function taskView(row: TaskRow): TrackerTask {
    return {
        id: row.id,
        opportunityId: row.opportunityId,
        title: row.title,
        dueOn: row.dueOn,
        priority: row.priority,
        done: row.done,
        completedAt: row.completedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    };
}
function opportunityView(row: OpportunityRow, children: TaskRow[] = []): TrackerOpportunity {
    return {
        id: row.id,
        programId: row.programId,
        cycleId: row.cycleId,
        priority: row.priority,
        status: row.status,
        notes: row.notes,
        submittedOn: row.submittedOn,
        nextAction: row.nextAction,
        plannedDeadline: row.plannedDeadline?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        tasks: children.map(taskView),
    };
}
function missing(): never {
    throw new AcceleratorError("Opportunity or task not found", 404, "tracker_not_found");
}

export async function listTrackerOpportunities(companyId: bigint): Promise<TrackerOpportunity[]> {
    const rows = await getDb()
        .select()
        .from(opportunities)
        .where(eq(opportunities.companyId, companyId))
        .orderBy(asc(opportunities.createdAt), asc(opportunities.id));
    if (!rows.length) return [];
    const children = await getDb()
        .select()
        .from(tasks)
        .where(
            and(
                eq(tasks.companyId, companyId),
                inArray(
                    tasks.opportunityId,
                    rows.map(row => row.id)
                )
            )
        )
        .orderBy(asc(tasks.createdAt), asc(tasks.id));
    const byOpportunity = new Map<string, TaskRow[]>();
    for (const task of children) {
        const siblings = byOpportunity.get(task.opportunityId);
        if (siblings) siblings.push(task);
        else byOpportunity.set(task.opportunityId, [task]);
    }
    return rows.map(row => opportunityView(row, byOpportunity.get(row.id)));
}

export async function getTrackerOpportunity(
    companyId: bigint,
    id: string
): Promise<TrackerOpportunity | null> {
    const [row] = await getDb()
        .select()
        .from(opportunities)
        .where(and(eq(opportunities.companyId, companyId), eq(opportunities.id, id)))
        .limit(1);
    if (!row) return null;
    const children = await getDb()
        .select()
        .from(tasks)
        .where(and(eq(tasks.companyId, companyId), eq(tasks.opportunityId, id)))
        .orderBy(asc(tasks.createdAt), asc(tasks.id));
    return opportunityView(row, children);
}

/** All opportunity mutations share this lock, including saves before a row exists. */
async function withProgramLock<T>(
    companyId: bigint,
    programId: string,
    work: (tx: Pick<DbClient, "select" | "insert" | "update" | "delete" | "execute">) => Promise<T>
): Promise<T> {
    return getDb().transaction(async tx => {
        await tx.execute(
            sql`select pg_advisory_xact_lock(hashtextextended(${`accelerator-tracker:${companyId}:${programId}`}, 0))`
        );
        return work(tx);
    });
}

export async function saveTrackerOpportunity(
    companyId: bigint,
    input: SaveTrackerOpportunity,
    officialDeadline: string | null
): Promise<TrackerOpportunity> {
    const id = await withProgramLock(companyId, input.programId, async tx => {
        const rows = await tx
            .select()
            .from(opportunities)
            .where(
                and(
                    eq(opportunities.companyId, companyId),
                    eq(opportunities.programId, input.programId)
                )
            );
        const selection = selectTrackerOpportunity(rows, input.cycleId ?? null);
        if (selection.kind === "existing") return selection.opportunity.id;
        const plannedDeadline = officialDeadline ? new Date(officialDeadline) : null;
        if (selection.kind === "upgrade") {
            const row = selection.opportunity;
            await tx
                .update(opportunities)
                .set({
                    cycleId: input.cycleId,
                    plannedDeadline: row.plannedDeadline ?? plannedDeadline,
                    updatedAt: new Date(),
                })
                .where(and(eq(opportunities.companyId, companyId), eq(opportunities.id, row.id)));
            return row.id;
        }
        const [row] = await tx
            .insert(opportunities)
            .values({
                companyId,
                programId: input.programId,
                cycleId: input.cycleId ?? null,
                plannedDeadline,
            })
            .returning({ id: opportunities.id });
        return row!.id;
    });
    return (await getTrackerOpportunity(companyId, id)) ?? missing();
}

export async function updateTrackerOpportunity(
    companyId: bigint,
    id: string,
    patch: UpdateTrackerOpportunity,
    officialDeadline: string | null
): Promise<TrackerOpportunity> {
    const existing = await getTrackerOpportunity(companyId, id);
    if (!existing) missing();
    await withProgramLock(companyId, existing.programId, async tx => {
        const [row] = await tx
            .select()
            .from(opportunities)
            .where(and(eq(opportunities.companyId, companyId), eq(opportunities.id, id)));
        if (!row) missing();
        if (patch.cycleId !== undefined) {
            assertTrackerCycleChange(row.cycleId, patch.cycleId);
            if (row.cycleId !== patch.cycleId) {
                const [duplicate] = await tx
                    .select({ id: opportunities.id })
                    .from(opportunities)
                    .where(
                        and(
                            eq(opportunities.companyId, companyId),
                            eq(opportunities.programId, row.programId),
                            eq(opportunities.cycleId, patch.cycleId!)
                        )
                    )
                    .limit(1);
                if (duplicate)
                    throw new AcceleratorError(
                        "This cycle is already saved",
                        409,
                        "opportunity_exists"
                    );
            }
        }
        const { plannedDeadline, ...fields } = patch;
        await tx
            .update(opportunities)
            .set({
                ...fields,
                plannedDeadline:
                    plannedDeadline !== undefined
                        ? plannedDeadline === null
                            ? null
                            : new Date(plannedDeadline)
                        : row.cycleId === null &&
                            patch.cycleId != null &&
                            row.plannedDeadline === null &&
                            officialDeadline
                          ? new Date(officialDeadline)
                          : row.plannedDeadline,
                updatedAt: new Date(),
            })
            .where(and(eq(opportunities.companyId, companyId), eq(opportunities.id, id)));
    });
    return (await getTrackerOpportunity(companyId, id)) ?? missing();
}

export async function deleteTrackerOpportunity(companyId: bigint, id: string): Promise<void> {
    const existing = await getTrackerOpportunity(companyId, id);
    if (!existing) missing();
    await withProgramLock(companyId, existing.programId, async tx => {
        const deleted = await tx
            .delete(opportunities)
            .where(and(eq(opportunities.companyId, companyId), eq(opportunities.id, id)))
            .returning({ id: opportunities.id });
        if (!deleted.length) missing();
    });
}

export async function createTrackerTask(
    companyId: bigint,
    opportunityId: string,
    input: CreateTrackerTask
): Promise<TrackerTask> {
    return getDb().transaction(async tx => {
        const [parent] = await tx
            .select({ id: opportunities.id })
            .from(opportunities)
            .where(and(eq(opportunities.companyId, companyId), eq(opportunities.id, opportunityId)))
            .for("update");
        if (!parent) missing();
        const now = new Date();
        const [row] = await tx
            .insert(tasks)
            .values({
                companyId,
                opportunityId,
                title: input.title,
                dueOn: input.dueOn ?? null,
                priority: input.priority ?? "medium",
                done: input.done ?? false,
                completedAt: input.done ? now : null,
            })
            .returning();
        return taskView(row!);
    });
}

export async function updateTrackerTask(
    companyId: bigint,
    opportunityId: string,
    taskId: string,
    patch: UpdateTrackerTask
): Promise<TrackerTask> {
    return getDb().transaction(async tx => {
        const condition = and(
            eq(tasks.companyId, companyId),
            eq(tasks.opportunityId, opportunityId),
            eq(tasks.id, taskId)
        );
        const [existing] = await tx.select().from(tasks).where(condition).for("update");
        if (!existing) missing();
        const now = new Date();
        const [row] = await tx
            .update(tasks)
            .set({
                ...patch,
                completedAt: trackerCompletionTime(
                    existing.done,
                    existing.completedAt,
                    patch.done,
                    now
                ),
                updatedAt: now,
            })
            .where(condition)
            .returning();
        return taskView(row!);
    });
}

export async function deleteTrackerTask(
    companyId: bigint,
    opportunityId: string,
    taskId: string
): Promise<void> {
    const deleted = await getDb()
        .delete(tasks)
        .where(
            and(
                eq(tasks.companyId, companyId),
                eq(tasks.opportunityId, opportunityId),
                eq(tasks.id, taskId)
            )
        )
        .returning({ id: tasks.id });
    if (!deleted.length) missing();
}
