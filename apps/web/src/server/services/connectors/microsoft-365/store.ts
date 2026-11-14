/**
 * Microsoft 365 state hanging off a connection: the sync lease, the last
 * run, and the picked-item list. The OAuth grant itself lives on the shared
 * connector_connections row (see ~/server/services/microsoft/connections).
 *
 * There is no change cursor: every run walks the picks, and fingerprints
 * from the listing stop unchanged files from downloading again. The lease
 * keeps two runs from storing the same new file twice.
 */

import { and, eq, isNull, lt, or, sql } from "drizzle-orm";

import { db } from "~/server/db";
import {
    microsoft365PickedItem,
    microsoft365SyncState,
    type Microsoft365PickedItem,
    type Microsoft365SyncState,
} from "~/server/db/schema/connectors";

/** A lease older than this is stale: the holder crashed or was killed. */
const SYNC_LEASE_STALE_MS = 10 * 60 * 1000;

export async function getSyncState(connectionId: number): Promise<Microsoft365SyncState | null> {
    const [row] = await db
        .select()
        .from(microsoft365SyncState)
        .where(eq(microsoft365SyncState.connectionId, connectionId))
        .limit(1);
    return row ?? null;
}

/** Idempotent: the row is created on connect and survives re-auth. */
export async function ensureSyncState(connectionId: number): Promise<void> {
    await db.insert(microsoft365SyncState).values({ connectionId }).onConflictDoNothing();
}

/** True when this call claimed the lease; false when another sync holds it. */
export async function claimSyncLease(connectionId: number): Promise<boolean> {
    const staleBefore = new Date(Date.now() - SYNC_LEASE_STALE_MS);
    const claimed = await db
        .update(microsoft365SyncState)
        .set({ syncLockedAt: new Date(), lastSyncStatus: "running" })
        .where(
            and(
                eq(microsoft365SyncState.connectionId, connectionId),
                or(
                    isNull(microsoft365SyncState.syncLockedAt),
                    lt(microsoft365SyncState.syncLockedAt, staleBefore)
                )
            )
        )
        .returning({ connectionId: microsoft365SyncState.connectionId });
    return claimed.length > 0;
}

export interface ReleaseSyncLeaseParams {
    readonly status: "ok" | "error";
    readonly error?: string | null;
    readonly report?: Record<string, unknown> | null;
}

export async function releaseSyncLease(
    connectionId: number,
    params: ReleaseSyncLeaseParams
): Promise<void> {
    await db
        .update(microsoft365SyncState)
        .set({
            syncLockedAt: null,
            lastSyncAt: new Date(),
            lastSyncStatus: params.status,
            lastSyncError: params.error ?? null,
            ...(params.report !== undefined ? { lastSyncReport: params.report } : {}),
        })
        .where(eq(microsoft365SyncState.connectionId, connectionId));
}

// ── Picked items ─────────────────────────────────────────────────────

export async function listPickedItems(connectionId: number): Promise<Microsoft365PickedItem[]> {
    return db
        .select()
        .from(microsoft365PickedItem)
        .where(eq(microsoft365PickedItem.connectionId, connectionId))
        .orderBy(microsoft365PickedItem.name);
}

export interface PickedItemInput {
    readonly driveId: string;
    readonly itemId: string;
    readonly kind: "file" | "folder";
    readonly name: string;
    readonly mimeType: string | null;
    /** Where it opens in OneDrive or SharePoint. */
    readonly webUrl: string | null;
}

/** One picked item's address: the drive it lives in and its id there. */
export interface PickedItemRef {
    readonly driveId: string;
    readonly itemId: string;
}

/**
 * `destination` is the folder chosen in Add source (see the column). A
 * re-pick that names one takes it; it only matters for files not placed
 * yet, and what is already in LaunchStack stays where it is.
 */
export async function addPickedItems(
    connectionId: number,
    items: readonly PickedItemInput[],
    addedByUserPk: number,
    destination: string | null = null
): Promise<void> {
    if (items.length === 0) return;
    await db
        .insert(microsoft365PickedItem)
        .values(
            items.map(item => ({
                connectionId,
                driveId: item.driveId,
                itemId: item.itemId,
                kind: item.kind,
                name: item.name,
                mimeType: item.mimeType,
                webUrl: item.webUrl,
                addedByUserPk,
                destination,
            }))
        )
        // Picking the same thing again must converge, not error.
        .onConflictDoUpdate({
            target: [
                microsoft365PickedItem.connectionId,
                microsoft365PickedItem.driveId,
                microsoft365PickedItem.itemId,
            ],
            set: {
                name: sql`excluded.name`,
                mimeType: sql`excluded.mime_type`,
                kind: sql`excluded.kind`,
                webUrl: sql`coalesce(excluded.web_url, ${microsoft365PickedItem.webUrl})`,
                destination: sql`coalesce(excluded.destination, ${microsoft365PickedItem.destination})`,
            },
        });
}

export async function removePickedItems(
    connectionId: number,
    items: readonly PickedItemRef[]
): Promise<void> {
    if (items.length === 0) return;
    await db
        .delete(microsoft365PickedItem)
        .where(
            and(
                eq(microsoft365PickedItem.connectionId, connectionId),
                or(
                    ...items.map(item =>
                        and(
                            eq(microsoft365PickedItem.driveId, item.driveId),
                            eq(microsoft365PickedItem.itemId, item.itemId)
                        )
                    )
                )
            )
        );
}
