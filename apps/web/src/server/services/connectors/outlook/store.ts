/**
 * Outlook-specific state hanging off a connection: the per-folder delta
 * links, the sync lease, and the mail folders and searches the member chose
 * to sync. The OAuth grant itself lives on the shared connector_connections
 * row.
 *
 * Same lease discipline as Gmail and Drive: the delta links advance only
 * inside the lease, and a stale lease (a crashed worker) is reclaimable
 * after ten minutes.
 */

import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";

import { db } from "~/server/db";
import { connectorConnections } from "~/server/db/schema";
import {
    outlookSyncScope,
    outlookSyncState,
    type OutlookSyncScope,
    type OutlookSyncState,
} from "~/server/db/schema/connectors";

/** A lease older than this is stale: the holder crashed or was killed. */
const SYNC_LEASE_STALE_MS = 10 * 60 * 1000;

export async function getSyncState(connectionId: number): Promise<OutlookSyncState | null> {
    const [row] = await db
        .select()
        .from(outlookSyncState)
        .where(eq(outlookSyncState.connectionId, connectionId))
        .limit(1);
    return row ?? null;
}

/** Idempotent: the row is created on connect and survives re-auth. */
export async function ensureSyncState(connectionId: number): Promise<void> {
    await db
        .insert(outlookSyncState)
        .values({ connectionId })
        .onConflictDoNothing({ target: outlookSyncState.connectionId });
}

/** A different mailbox has different folders and delta links: start over. */
export async function resetSyncState(connectionId: number): Promise<void> {
    await db
        .insert(outlookSyncState)
        .values({ connectionId })
        .onConflictDoUpdate({
            target: outlookSyncState.connectionId,
            set: {
                deltaLinks: null,
                lastSyncStatus: null,
                lastSyncError: null,
                lastSyncReport: null,
                syncLockedAt: null,
            },
        });
}

/** True when this call claimed the lease; false when another sync holds it. */
export async function claimSyncLease(connectionId: number): Promise<boolean> {
    const staleBefore = new Date(Date.now() - SYNC_LEASE_STALE_MS);
    const claimed = await db
        .update(outlookSyncState)
        .set({ syncLockedAt: new Date(), lastSyncStatus: "running" })
        .where(
            and(
                eq(outlookSyncState.connectionId, connectionId),
                or(
                    isNull(outlookSyncState.syncLockedAt),
                    lt(outlookSyncState.syncLockedAt, staleBefore)
                )
            )
        )
        .returning({ connectionId: outlookSyncState.connectionId });
    return claimed.length > 0;
}

export interface ReleaseSyncLeaseParams {
    readonly status: "ok" | "error";
    readonly error?: string | null;
    /** Replaces the stored map whole, and only on success: a failed run must see its changes again. */
    readonly deltaLinks?: Record<string, string> | null;
    readonly report?: Record<string, unknown> | null;
}

export async function releaseSyncLease(
    connectionId: number,
    params: ReleaseSyncLeaseParams
): Promise<void> {
    await db
        .update(outlookSyncState)
        .set({
            syncLockedAt: null,
            lastSyncAt: new Date(),
            lastSyncStatus: params.status,
            lastSyncError: params.error ?? null,
            ...(params.status === "ok" && params.deltaLinks
                ? { deltaLinks: params.deltaLinks }
                : {}),
            ...(params.report !== undefined ? { lastSyncReport: params.report } : {}),
        })
        .where(eq(outlookSyncState.connectionId, connectionId));
}

// ── Scope: the mail folders and searches the member picked ────────────

export type OutlookScopeKind = "folder" | "query";

export interface ScopeInput {
    readonly kind: OutlookScopeKind;
    readonly value: string;
    readonly name: string;
}

export async function listScope(connectionId: number): Promise<OutlookSyncScope[]> {
    return db
        .select()
        .from(outlookSyncScope)
        .where(eq(outlookSyncScope.connectionId, connectionId))
        .orderBy(outlookSyncScope.kind, outlookSyncScope.name);
}

export async function addScope(connectionId: number, items: readonly ScopeInput[]): Promise<void> {
    if (items.length === 0) return;
    await db
        .insert(outlookSyncScope)
        .values(
            items.map(item => ({
                connectionId,
                kind: item.kind,
                value: item.value,
                name: item.name,
            }))
        )
        // Picking the same folder again converges on its row (it may have been renamed).
        .onConflictDoUpdate({
            target: [outlookSyncScope.connectionId, outlookSyncScope.kind, outlookSyncScope.value],
            set: { name: sql`excluded.name` },
        });
}

export async function removeScope(connectionId: number, ids: readonly bigint[]): Promise<number> {
    if (ids.length === 0) return 0;
    const removed = await db
        .delete(outlookSyncScope)
        .where(
            and(
                eq(outlookSyncScope.connectionId, connectionId),
                inArray(outlookSyncScope.id, [...ids])
            )
        )
        .returning({ id: outlookSyncScope.id });
    return removed.length;
}

// ── Disconnect ────────────────────────────────────────────────────────

/**
 * Delete the member's connection. Its sync state and scope cascade; the
 * documents it brought in stay in the private folder. Microsoft gives a
 * confidential client no endpoint to revoke a delegated refresh token, so
 * deleting our stored copy is the whole of the disconnect: we can no longer
 * mint access tokens, and the app stays listed on the member's Microsoft
 * account until they remove it there.
 */
export async function deleteOutlookConnection(connectionId: number): Promise<boolean> {
    const removed = await db
        .delete(connectorConnections)
        .where(eq(connectorConnections.id, connectionId))
        .returning({ id: connectorConnections.id });
    return removed.length > 0;
}
