/**
 * The app's reads and writes of extraction tables: what the routes need
 * around the engine's own store (`@launchstack/pipelines/extraction/db`,
 * which the run loop uses). Reads that serve a person are scoped by
 * company_id; who may see or change a table is decided in `./service`.
 */
import { and, asc, desc, eq, inArray, isNotNull, not, or, sql } from "drizzle-orm";

import { extractionRows, extractionTables } from "@launchstack/pipelines/extraction/schema";
import { toRowRecord, toTableRecord } from "@launchstack/pipelines/extraction/db";
import {
    EMPTY_EXTRACTION_USAGE,
    type ExtractionField,
    type ExtractionRowRecord,
    type ExtractionTableRecord,
} from "@launchstack/pipelines/extraction/types";
import { document, documentVersions } from "@launchstack/store/schema";

import { scopedDocumentWhere } from "~/lib/authz/scope";
import type { DocumentScope } from "~/lib/authz/scope-types";
import type { ExtractionCounts } from "~/lib/extraction/types";
import { db } from "~/server/db";
import { originalMediaDocument } from "~/server/workspace-sources";

export const EMPTY_COUNTS: ExtractionCounts = {
    total: 0,
    pending: 0,
    running: 0,
    done: 0,
    failed: 0,
};

export async function getCompanyTable(
    companyId: bigint,
    id: number
): Promise<ExtractionTableRecord | null> {
    const [row] = await db
        .select()
        .from(extractionTables)
        .where(and(eq(extractionTables.companyId, companyId), eq(extractionTables.id, id)))
        .limit(1);
    return row ? toTableRecord(row) : null;
}

/** The viewer's own tables and the ones shared with the workspace, newest first. */
export async function listVisibleTables(
    companyId: bigint,
    viewerUserId: string
): Promise<ExtractionTableRecord[]> {
    const rows = await db
        .select()
        .from(extractionTables)
        .where(
            and(
                eq(extractionTables.companyId, companyId),
                or(
                    eq(extractionTables.createdByUserId, viewerUserId),
                    isNotNull(extractionTables.sharedAt)
                )
            )
        )
        .orderBy(desc(extractionTables.createdAt), desc(extractionTables.id))
        .limit(200);
    return rows.map(toTableRecord);
}

/** Rows by status for each table; a table with no rows is absent. */
export async function countRowsByTable(
    tableIds: readonly number[]
): Promise<Map<number, ExtractionCounts>> {
    const out = new Map<number, ExtractionCounts>();
    if (tableIds.length === 0) return out;
    const rows = await db
        .select({
            tableId: extractionRows.tableId,
            status: extractionRows.status,
            n: sql<number>`count(*)::int`,
        })
        .from(extractionRows)
        .where(inArray(extractionRows.tableId, [...tableIds]))
        .groupBy(extractionRows.tableId, extractionRows.status);
    for (const row of rows) {
        const counts = out.get(row.tableId) ?? { ...EMPTY_COUNTS };
        const n = Number(row.n);
        counts[row.status] += n;
        counts.total += n;
        out.set(row.tableId, counts);
    }
    return out;
}

/** A table's rows in the order they were added. */
export async function listTableRows(tableId: number): Promise<ExtractionRowRecord[]> {
    const rows = await db
        .select()
        .from(extractionRows)
        .where(eq(extractionRows.tableId, tableId))
        .orderBy(asc(extractionRows.id));
    return rows.map(toRowRecord);
}

export interface NewExtractionTable {
    companyId: bigint;
    createdByUserId: string;
    title: string;
    fields: ExtractionField[];
    documents: ReadonlyArray<{ id: number; title: string }>;
}

/** The table and one pending row per document, together or not at all. */
export async function insertTable(input: NewExtractionTable): Promise<ExtractionTableRecord> {
    return db.transaction(async tx => {
        const [table] = await tx
            .insert(extractionTables)
            .values({
                companyId: input.companyId,
                createdByUserId: input.createdByUserId,
                title: input.title,
                fields: input.fields,
                status: "queued",
                usage: { ...EMPTY_EXTRACTION_USAGE },
            })
            .returning();
        if (!table) throw new Error("The extraction table was not created");
        // 500 documents × 7 parameters stays far under the driver's limit.
        await tx.insert(extractionRows).values(
            input.documents.map(doc => ({
                tableId: table.id,
                companyId: input.companyId,
                documentId: doc.id,
                documentTitle: doc.title.slice(0, 256),
                status: "pending" as const,
                cells: {},
            }))
        );
        return toTableRecord(table);
    });
}

export async function updateTableMeta(
    companyId: bigint,
    id: number,
    patch: { title?: string; shared?: boolean },
    now: Date
): Promise<void> {
    const set: Partial<typeof extractionTables.$inferInsert> = {};
    if (patch.title !== undefined) set.title = patch.title;
    if (patch.shared !== undefined) set.sharedAt = patch.shared ? now : null;
    if (Object.keys(set).length === 0) return;
    await db
        .update(extractionTables)
        .set(set)
        .where(and(eq(extractionTables.companyId, companyId), eq(extractionTables.id, id)));
}

export async function deleteTable(companyId: bigint, id: number): Promise<void> {
    await db
        .delete(extractionTables)
        .where(and(eq(extractionTables.companyId, companyId), eq(extractionTables.id, id)));
}

/** Ask an unfinished table to stop; the run loop looks at the flag between batches. */
export async function requestCancel(companyId: bigint, id: number, now: Date): Promise<void> {
    await db
        .update(extractionTables)
        .set({ cancelRequestedAt: now })
        .where(
            and(
                eq(extractionTables.companyId, companyId),
                eq(extractionTables.id, id),
                inArray(extractionTables.status, ["queued", "running"])
            )
        );
}

/**
 * Put rows back to pending and the table back to queued, in one transaction.
 * `rowIds` null means every failed row. A row keeps its cells; its error is
 * cleared. Returns how many rows were put back; with none, the table is left
 * as it was. The table is only re-queued from a finished state, so a run that
 * started in between is never restarted under itself.
 */
export async function requeueRows(
    companyId: bigint,
    tableId: number,
    rowIds: readonly number[] | null
): Promise<number> {
    return db.transaction(async tx => {
        // Lock the table row first: a run cannot start between the check and the writes.
        const [table] = await tx
            .select({ id: extractionTables.id })
            .from(extractionTables)
            .where(
                and(
                    eq(extractionTables.companyId, companyId),
                    eq(extractionTables.id, tableId),
                    inArray(extractionTables.status, ["done", "failed", "cancelled"])
                )
            )
            .for("update");
        if (!table) return 0;
        const rows = await tx
            .update(extractionRows)
            .set({ status: "pending", error: null })
            .where(
                and(
                    eq(extractionRows.tableId, tableId),
                    rowIds === null
                        ? // Every row without a result: the failed ones, and the
                          // ones a stopped run never reached.
                          inArray(extractionRows.status, ["failed", "pending", "running"])
                        : inArray(extractionRows.id, [...rowIds])
                )
            )
            .returning({ id: extractionRows.id });
        if (rows.length === 0) return 0;
        await tx
            .update(extractionTables)
            .set({
                status: "queued",
                error: null,
                finishedAt: null,
                cancelRequestedAt: null,
                leaseUntil: null,
            })
            .where(eq(extractionTables.id, tableId));
        return rows.length;
    });
}

// --- documents ----------------------------------------------------------------

/** The documents among `ids` that `scope` lets its holder read, with their titles. */
export async function readableDocuments(
    companyId: bigint,
    scope: DocumentScope,
    ids: readonly number[]
): Promise<Array<{ id: number; title: string }>> {
    if (ids.length === 0) return [];
    const rows = await db
        .select({ id: document.id, title: document.title })
        .from(document)
        .where(and(scopedDocumentWhere(companyId, scope), inArray(document.id, [...new Set(ids)])));
    return rows.map(row => ({ id: Number(row.id), title: row.title }));
}

export interface ReadableSourceRow {
    id: number;
    title: string;
    folder: string;
    mimeType: string | null;
    /** The current version has finished processing. */
    processed: boolean;
}

/** Sources offered per request; newest first. */
export const SOURCE_OPTIONS_MAX = 2000;

/**
 * Every document the scope's holder can read, newest first. Readiness
 * follows the current version, as the Sources rail's does: a missing or
 * queued current version must not inherit an older success.
 */
export async function listReadableSourceRows(
    companyId: bigint,
    scope: DocumentScope
): Promise<ReadableSourceRow[]> {
    const rows = await db
        .select({
            id: document.id,
            title: document.title,
            folder: document.category,
            mimeType: document.mimeType,
            currentVersionId: document.currentVersionId,
            ocrProcessed: document.ocrProcessed,
            versionProcessed: documentVersions.ocrProcessed,
        })
        .from(document)
        .leftJoin(
            documentVersions,
            and(
                eq(documentVersions.id, document.currentVersionId),
                eq(documentVersions.documentId, document.id)
            )
        )
        // A recording has no text of its own; its transcript is the file to pick.
        .where(and(scopedDocumentWhere(companyId, scope), not(originalMediaDocument())))
        .orderBy(desc(document.createdAt), desc(document.id))
        .limit(SOURCE_OPTIONS_MAX);
    return rows.map(row => ({
        id: Number(row.id),
        title: row.title,
        folder: row.folder,
        mimeType: row.mimeType ?? null,
        processed:
            (row.currentVersionId !== null ? row.versionProcessed : row.ocrProcessed) === true,
    }));
}
