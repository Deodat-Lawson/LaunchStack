/**
 * Notion-specific state hanging off a connection: the sync lease, the last
 * run's summary, and the folder its pages land in. The OAuth grant itself
 * lives on the shared connector_connections row.
 *
 * Same lease discipline as Drive and Gmail: one run per connection, and a
 * stale lease (a crashed worker) is reclaimable after ten minutes.
 */

import { and, eq, inArray, isNull, lt, or } from "drizzle-orm";

import { db } from "~/server/db";
import { notionSyncState, type NotionSyncState } from "~/server/db/schema/connectors";

/** A lease older than this is stale — the holder crashed or was killed. */
const SYNC_LEASE_STALE_MS = 10 * 60 * 1000;

export async function getSyncState(connectionId: number): Promise<NotionSyncState | null> {
    const [row] = await db
        .select()
        .from(notionSyncState)
        .where(eq(notionSyncState.connectionId, connectionId))
        .limit(1);
    return row ?? null;
}

/** State rows for several connections at once (the status route). */
export async function getSyncStates(
    connectionIds: readonly number[]
): Promise<Map<number, NotionSyncState>> {
    if (connectionIds.length === 0) return new Map();
    const rows = await db
        .select()
        .from(notionSyncState)
        .where(inArray(notionSyncState.connectionId, [...connectionIds]));
    return new Map(rows.map(row => [row.connectionId, row]));
}

/** Idempotent: the row is created on connect and survives re-auth. */
export async function ensureSyncState(connectionId: number): Promise<void> {
    await db
        .insert(notionSyncState)
        .values({ connectionId })
        .onConflictDoNothing({ target: notionSyncState.connectionId });
}

/** True when this call claimed the lease; false when another sync holds it. */
export async function claimSyncLease(connectionId: number): Promise<boolean> {
    const staleBefore = new Date(Date.now() - SYNC_LEASE_STALE_MS);
    const claimed = await db
        .update(notionSyncState)
        .set({ syncLockedAt: new Date(), lastSyncStatus: "running" })
        .where(
            and(
                eq(notionSyncState.connectionId, connectionId),
                or(
                    isNull(notionSyncState.syncLockedAt),
                    lt(notionSyncState.syncLockedAt, staleBefore)
                )
            )
        )
        .returning({ connectionId: notionSyncState.connectionId });
    return claimed.length > 0;
}

export async function rememberFolder(connectionId: number, categoryId: number): Promise<void> {
    await db
        .update(notionSyncState)
        .set({ folderCategoryId: categoryId })
        .where(eq(notionSyncState.connectionId, connectionId));
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
        .update(notionSyncState)
        .set({
            syncLockedAt: null,
            lastSyncAt: new Date(),
            lastSyncStatus: params.status,
            lastSyncError: params.error ?? null,
            ...(params.report !== undefined ? { lastSyncReport: params.report } : {}),
        })
        .where(eq(notionSyncState.connectionId, connectionId));
}
