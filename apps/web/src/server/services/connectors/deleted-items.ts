/**
 * Synced files someone deleted in LaunchStack (`connector_deleted_item`).
 *
 * Google Drive and Notion sync whatever a pick or a share reaches. Without
 * a record of the delete, the next run finds the file again, sees no
 * document for it, and imports it as new: delete it and it is back within
 * 15 minutes. So deleting a synced document leaves a row here, in the same
 * transaction, and each sync skips the files listed for its connection.
 * Nothing in Drive or Notion is touched.
 *
 * A row goes away when someone asks for the file back: "Sync again" in
 * Settings, or picking the Drive file (or the folder it came through) again
 * in Add source.
 */

import { and, eq, inArray, or } from "drizzle-orm";

import { db } from "~/server/db";
import { connectorDeletedItem } from "~/server/db/schema";
import type { Executor } from "~/server/workspace/db-types";

/** The connectors that sync by reach, and so need a delete remembered. */
const SYNCED_CONNECTORS = new Set(["google-drive", "notion"]);

export interface DeletedDocumentFacts {
    readonly title: string;
    /** `document.ocrMetadata`, where the sinks record where a file came from. */
    readonly metadata: unknown;
    readonly deletedByUserPk: number | null;
}

interface SyncedSource {
    readonly connectionId: number;
    readonly sourceId: string;
    readonly pickedRootId: string | null;
}

/** Where a synced document came from, or null for anything else. */
export function syncedSourceOf(metadata: unknown): SyncedSource | null {
    if (typeof metadata !== "object" || metadata === null) return null;
    const record = metadata as Record<string, unknown>;
    if (typeof record.connector !== "string" || !SYNCED_CONNECTORS.has(record.connector)) {
        return null;
    }
    const connectionId = Number(record.connectionId);
    const sourceId = record.sourceId;
    if (!Number.isSafeInteger(connectionId) || connectionId <= 0) return null;
    if (typeof sourceId !== "string" || sourceId.length === 0 || sourceId.length > 128) {
        return null;
    }
    const pickedRootId =
        typeof record.pickedRootId === "string" && record.pickedRootId.length <= 128
            ? record.pickedRootId
            : null;
    return { connectionId, sourceId, pickedRootId };
}

/**
 * Remember that a synced document was deleted, so its sync leaves it out.
 * Call inside the delete's transaction. A no-op for any other document.
 */
export async function rememberDeletedSource(
    executor: Executor,
    facts: DeletedDocumentFacts
): Promise<void> {
    const source = syncedSourceOf(facts.metadata);
    if (!source) return;
    await executor
        .insert(connectorDeletedItem)
        .values({
            connectionId: source.connectionId,
            sourceId: source.sourceId,
            pickedRootId: source.pickedRootId,
            title: facts.title,
            deletedByUserPk: facts.deletedByUserPk,
        })
        .onConflictDoUpdate({
            target: [connectorDeletedItem.connectionId, connectorDeletedItem.sourceId],
            set: {
                pickedRootId: source.pickedRootId,
                title: facts.title,
                deletedByUserPk: facts.deletedByUserPk,
                deletedAt: new Date(),
            },
        });
}

/** Source ids the next run of this connection must leave out. */
export async function listDeletedSourceIds(connectionId: number): Promise<string[]> {
    const rows = await db
        .select({ sourceId: connectorDeletedItem.sourceId })
        .from(connectorDeletedItem)
        .where(eq(connectorDeletedItem.connectionId, connectionId));
    return rows.map(row => row.sourceId);
}

/** Whether this one file was deleted here: the last check before a sync re-creates it. */
export async function isSourceDeleted(connectionId: number, sourceId: string): Promise<boolean> {
    const [row] = await db
        .select({ id: connectorDeletedItem.id })
        .from(connectorDeletedItem)
        .where(
            and(
                eq(connectorDeletedItem.connectionId, connectionId),
                eq(connectorDeletedItem.sourceId, sourceId)
            )
        )
        .limit(1);
    return row !== undefined;
}

export interface DeletedItemRow {
    readonly connectionId: number;
    readonly sourceId: string;
    readonly pickedRootId: string | null;
    readonly title: string;
    readonly deletedByUserPk: number | null;
    readonly deletedAt: Date;
}

export async function listDeletedItems(
    connectionIds: readonly number[]
): Promise<DeletedItemRow[]> {
    if (connectionIds.length === 0) return [];
    return db
        .select({
            connectionId: connectorDeletedItem.connectionId,
            sourceId: connectorDeletedItem.sourceId,
            pickedRootId: connectorDeletedItem.pickedRootId,
            title: connectorDeletedItem.title,
            deletedByUserPk: connectorDeletedItem.deletedByUserPk,
            deletedAt: connectorDeletedItem.deletedAt,
        })
        .from(connectorDeletedItem)
        .where(inArray(connectorDeletedItem.connectionId, [...connectionIds]))
        .orderBy(connectorDeletedItem.deletedAt);
}

/**
 * What Settings shows one viewer: the files they deleted, by name, and how
 * many others deleted. A deleted file's name reaches only the person who
 * deleted it — it may have sat in a folder no one else could open (ADR-014).
 */
export interface DeletedHereSummary {
    readonly items: readonly { sourceId: string; title: string; deletedAt: string }[];
    /** Deleted by someone else: counted, never named. */
    readonly others: number;
}

export function summarizeDeletedItems(
    rows: readonly DeletedItemRow[],
    viewerUserPk: number,
    options: { readonly listable?: (row: DeletedItemRow) => boolean } = {}
): DeletedHereSummary {
    const listable = options.listable ?? (() => true);
    const items: { sourceId: string; title: string; deletedAt: string }[] = [];
    let others = 0;
    for (const row of rows) {
        if (!listable(row)) continue;
        if (row.deletedByUserPk === viewerUserPk) {
            items.push({
                sourceId: row.sourceId,
                title: row.title,
                deletedAt: row.deletedAt.toISOString(),
            });
        } else {
            others += 1;
        }
    }
    return { items, others };
}

/**
 * A Drive file whose own pick was removed with its document comes back by
 * being picked again, not from this list (restoring the row alone would
 * bring nothing back). Its row stays, so a picked folder that also reaches
 * it doesn't re-import it.
 */
export function isListableDriveRow(row: DeletedItemRow): boolean {
    return row.pickedRootId !== row.sourceId;
}

/** Let the next sync bring these back. Returns how many rows went. */
export async function forgetDeletedItems(
    connectionId: number,
    target: { readonly sourceIds: readonly string[] }
): Promise<number> {
    if (target.sourceIds.length === 0) return 0;
    const rows = await db
        .delete(connectorDeletedItem)
        .where(
            and(
                eq(connectorDeletedItem.connectionId, connectionId),
                inArray(connectorDeletedItem.sourceId, [...target.sourceIds])
            )
        )
        .returning({ id: connectorDeletedItem.id });
    return rows.length;
}

/**
 * Picking a Drive file or folder again asks for it again: the file itself,
 * and everything deleted that came in through that folder.
 */
export async function forgetDeletedUnderPicks(
    connectionId: number,
    fileIds: readonly string[]
): Promise<void> {
    if (fileIds.length === 0) return;
    await db
        .delete(connectorDeletedItem)
        .where(
            and(
                eq(connectorDeletedItem.connectionId, connectionId),
                or(
                    inArray(connectorDeletedItem.sourceId, [...fileIds]),
                    inArray(connectorDeletedItem.pickedRootId, [...fileIds])
                )
            )
        );
}
