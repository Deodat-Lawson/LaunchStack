/**
 * Persistence for the extraction vertical. The engine reads by table id
 * because the table row carries the workspace the route resolved; reads that
 * serve a person are scoped by company_id in the app's server layer.
 */
import { and, asc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";

import { getDb } from "@launchstack/store/client";

import {
    extractionRows,
    extractionTables,
    type ExtractionRowRow,
    type ExtractionTableRow,
} from "./schema";
import type {
    ExtractionRowRecord,
    ExtractionRowStatus,
    ExtractionStore,
    ExtractionTableRecord,
} from "./types";
import { EMPTY_EXTRACTION_USAGE } from "./types";

const ACTIVE = ["queued", "running"] as const;

export function toTableRecord(row: ExtractionTableRow): ExtractionTableRecord {
    return {
        id: row.id,
        companyId: row.companyId,
        createdByUserId: row.createdByUserId,
        title: row.title,
        fields: row.fields ?? [],
        status: row.status,
        usage: { ...EMPTY_EXTRACTION_USAGE, ...(row.usage ?? {}) },
        error: row.error ?? null,
        sharedAt: row.sharedAt ?? null,
        cancelRequestedAt: row.cancelRequestedAt ?? null,
        leaseUntil: row.leaseUntil ?? null,
        createdAt: row.createdAt,
        startedAt: row.startedAt ?? null,
        finishedAt: row.finishedAt ?? null,
    };
}

export function toRowRecord(row: ExtractionRowRow): ExtractionRowRecord {
    return {
        id: row.id,
        tableId: row.tableId,
        companyId: row.companyId,
        documentId: row.documentId,
        documentTitle: row.documentTitle,
        status: row.status,
        cells: row.cells ?? {},
        error: row.error ?? null,
        attempts: row.attempts,
    };
}

export async function getTableById(id: number): Promise<ExtractionTableRecord | undefined> {
    const [row] = await getDb()
        .select()
        .from(extractionTables)
        .where(eq(extractionTables.id, id))
        .limit(1);
    return row ? toTableRecord(row) : undefined;
}

/** Claim the in-process lease; false when another process holds a live one. */
export async function claimLease(tableId: number, now: Date, until: Date): Promise<boolean> {
    const rows = await getDb()
        .update(extractionTables)
        .set({ leaseUntil: until })
        .where(
            and(
                eq(extractionTables.id, tableId),
                inArray(extractionTables.status, [...ACTIVE]),
                or(isNull(extractionTables.leaseUntil), lt(extractionTables.leaseUntil, now))
            )
        )
        .returning({ id: extractionTables.id });
    return rows.length > 0;
}

export async function renewLease(tableId: number, until: Date): Promise<void> {
    await getDb()
        .update(extractionTables)
        .set({ leaseUntil: until })
        .where(eq(extractionTables.id, tableId));
}

export async function releaseLease(tableId: number): Promise<void> {
    await getDb()
        .update(extractionTables)
        .set({ leaseUntil: null })
        .where(eq(extractionTables.id, tableId));
}

export function createExtractionStore(): ExtractionStore {
    return {
        async getTable(tableId) {
            return (await getTableById(tableId)) ?? null;
        },
        async markRunning(tableId, now) {
            await getDb()
                .update(extractionTables)
                .set({ status: "running", startedAt: now })
                .where(
                    and(eq(extractionTables.id, tableId), eq(extractionTables.status, "queued"))
                );
        },
        async claimRows(tableId, limit) {
            if (limit <= 0) return [];
            const db = getDb();
            // One statement. The pick is a CTE on purpose: with the locking
            // select written straight into `IN (…)`, Postgres may run it again
            // for each candidate row and claim far more than `limit` (it did:
            // 23 of 24 with a limit of 8). A CTE that locks rows is evaluated
            // once. It skips rows another claim already locked, so two callers
            // never share one.
            const picked = db.$with("picked").as(
                db
                    .select({ id: extractionRows.id })
                    .from(extractionRows)
                    .where(
                        and(
                            eq(extractionRows.tableId, tableId),
                            eq(extractionRows.status, "pending")
                        )
                    )
                    .orderBy(asc(extractionRows.id))
                    .limit(limit)
                    .for("update", { skipLocked: true })
            );
            const rows = await db
                .with(picked)
                .update(extractionRows)
                .set({
                    status: "running",
                    attempts: sql`${extractionRows.attempts} + 1`,
                    error: null,
                })
                .where(
                    and(
                        inArray(extractionRows.id, db.select({ id: picked.id }).from(picked)),
                        eq(extractionRows.status, "pending")
                    )
                )
                .returning();
            return rows.map(toRowRecord).sort((a, b) => a.id - b.id);
        },
        async completeRow(rowId, cells) {
            await getDb()
                .update(extractionRows)
                .set({ status: "done", cells, error: null })
                .where(and(eq(extractionRows.id, rowId), eq(extractionRows.status, "running")));
        },
        async failRow(rowId, error) {
            await getDb()
                .update(extractionRows)
                .set({ status: "failed", error })
                .where(and(eq(extractionRows.id, rowId), eq(extractionRows.status, "running")));
        },
        async releaseRunningRows(tableId) {
            const rows = await getDb()
                .update(extractionRows)
                .set({ status: "pending" })
                .where(
                    and(eq(extractionRows.tableId, tableId), eq(extractionRows.status, "running"))
                )
                .returning({ id: extractionRows.id });
            return rows.length;
        },
        async addUsage(tableId, usage) {
            // Added in SQL, so two units finishing together both count.
            const plus = (key: "calls" | "inputTokens" | "outputTokens") =>
                sql`coalesce((${extractionTables.usage} ->> ${sql.raw(`'${key}'`)})::bigint, 0) + ${Math.max(0, Math.round(usage[key]))}::bigint`;
            await getDb()
                .update(extractionTables)
                .set({
                    usage: sql`jsonb_build_object('calls', ${plus("calls")}, 'inputTokens', ${plus("inputTokens")}, 'outputTokens', ${plus("outputTokens")})`,
                })
                .where(eq(extractionTables.id, tableId));
        },
        async countRows(tableId) {
            const rows = await getDb()
                .select({
                    status: extractionRows.status,
                    count: sql<number>`count(*)::int`,
                })
                .from(extractionRows)
                .where(eq(extractionRows.tableId, tableId))
                .groupBy(extractionRows.status);
            const counts: Record<ExtractionRowStatus, number> = {
                pending: 0,
                running: 0,
                done: 0,
                failed: 0,
            };
            for (const row of rows) counts[row.status] = Number(row.count);
            return counts;
        },
        async finish(tableId, status, error, now) {
            await getDb()
                .update(extractionTables)
                .set({ status, error, finishedAt: now, leaseUntil: null })
                .where(
                    and(
                        eq(extractionTables.id, tableId),
                        inArray(extractionTables.status, [...ACTIVE])
                    )
                );
        },
    };
}
