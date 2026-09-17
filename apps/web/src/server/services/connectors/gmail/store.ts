/**
 * Gmail-specific state hanging off a connection: the history cursor, the
 * sync lease, and the labels/queries the member chose to sync. The OAuth
 * grant itself lives on the shared connector_connections row.
 *
 * Same lease discipline as Drive: the cursor advances only inside the lease,
 * and a stale lease (a crashed worker) is reclaimable after ten minutes.
 */

import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";

import { db } from "~/server/db";
import {
    gmailSyncScope,
    gmailSyncState,
    type GmailSyncScope,
    type GmailSyncState,
} from "~/server/db/schema/connectors";

/** A lease older than this is stale — the holder crashed or was killed. */
const SYNC_LEASE_STALE_MS = 10 * 60 * 1000;

export async function getSyncState(connectionId: number): Promise<GmailSyncState | null> {
    const [row] = await db
        .select()
        .from(gmailSyncState)
        .where(eq(gmailSyncState.connectionId, connectionId))
        .limit(1);
    return row ?? null;
}

/** Idempotent: the row is created on connect and survives re-auth. */
export async function ensureSyncState(connectionId: number): Promise<void> {
    await db
        .insert(gmailSyncState)
        .values({ connectionId })
        .onConflictDoNothing({ target: gmailSyncState.connectionId });
}

/** A different mailbox has different history ids: start over. */
export async function resetSyncState(connectionId: number): Promise<void> {
    await db
        .insert(gmailSyncState)
        .values({ connectionId })
        .onConflictDoUpdate({
            target: gmailSyncState.connectionId,
            set: {
                historyId: null,
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
        .update(gmailSyncState)
        .set({ syncLockedAt: new Date(), lastSyncStatus: "running" })
        .where(
            and(
                eq(gmailSyncState.connectionId, connectionId),
                or(isNull(gmailSyncState.syncLockedAt), lt(gmailSyncState.syncLockedAt, staleBefore))
            )
        )
        .returning({ connectionId: gmailSyncState.connectionId });
    return claimed.length > 0;
}

export interface ReleaseSyncLeaseParams {
    readonly status: "ok" | "error";
    readonly error?: string | null;
    /** Persisted only on success — a failed run must re-see its changes. */
    readonly historyId?: string | null;
    readonly report?: Record<string, unknown> | null;
}

export async function releaseSyncLease(
    connectionId: number,
    params: ReleaseSyncLeaseParams
): Promise<void> {
    await db
        .update(gmailSyncState)
        .set({
            syncLockedAt: null,
            lastSyncAt: new Date(),
            lastSyncStatus: params.status,
            lastSyncError: params.error ?? null,
            ...(params.historyId ? { historyId: params.historyId } : {}),
            ...(params.report !== undefined ? { lastSyncReport: params.report } : {}),
        })
        .where(eq(gmailSyncState.connectionId, connectionId));
}

// ── Scope: the labels and queries the member picked ───────────────────

export type GmailScopeKind = "label" | "query";

export interface ScopeInput {
    readonly kind: GmailScopeKind;
    readonly value: string;
    readonly name: string;
}

export async function listScope(connectionId: number): Promise<GmailSyncScope[]> {
    return db
        .select()
        .from(gmailSyncScope)
        .where(eq(gmailSyncScope.connectionId, connectionId))
        .orderBy(gmailSyncScope.kind, gmailSyncScope.name);
}

export async function addScope(connectionId: number, items: readonly ScopeInput[]): Promise<void> {
    if (items.length === 0) return;
    await db
        .insert(gmailSyncScope)
        .values(items.map(item => ({ connectionId, kind: item.kind, value: item.value, name: item.name })))
        // Re-picking the same label converges on its row (the name may have changed).
        .onConflictDoUpdate({
            target: [gmailSyncScope.connectionId, gmailSyncScope.kind, gmailSyncScope.value],
            set: { name: sql`excluded.name` },
        });
}

export async function removeScope(connectionId: number, ids: readonly bigint[]): Promise<number> {
    if (ids.length === 0) return 0;
    const removed = await db
        .delete(gmailSyncScope)
        .where(and(eq(gmailSyncScope.connectionId, connectionId), inArray(gmailSyncScope.id, [...ids])))
        .returning({ id: gmailSyncScope.id });
    return removed.length;
}
