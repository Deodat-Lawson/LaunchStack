/**
 * Drive-specific state hanging off a connection: the changes-feed cursor,
 * the sync lease, and the picked-item list. The OAuth grant itself lives on
 * the shared connector_connections row (see ../connection-store).
 *
 * The race that matters (two syncs advancing startPageToken) is handled by
 * the lease, not by token locking — see connection-store for why refresh
 * itself needs no lock.
 */

import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";

import { db } from "~/server/db";
import {
    googleDrivePickedItem,
    googleDriveSyncState,
    type GoogleDrivePickedItem,
    type GoogleDriveSyncState,
} from "~/server/db/schema/connectors";

/** A lease older than this is stale — the holder crashed or was killed. */
const SYNC_LEASE_STALE_MS = 10 * 60 * 1000;

export async function getSyncState(connectionId: number): Promise<GoogleDriveSyncState | null> {
    const [row] = await db
        .select()
        .from(googleDriveSyncState)
        .where(eq(googleDriveSyncState.connectionId, connectionId))
        .limit(1);
    return row ?? null;
}

/** Idempotent: the row is created on connect and survives re-auth. */
export async function ensureSyncState(
    connectionId: number,
    startPageToken?: string
): Promise<void> {
    await db
        .insert(googleDriveSyncState)
        .values({ connectionId, startPageToken: startPageToken ?? null })
        .onConflictDoUpdate({
            target: googleDriveSyncState.connectionId,
            // Re-auth reseeds the cursor only when one was handed in — an
            // existing cursor must not be wiped by a token refresh.
            set: startPageToken ? { startPageToken } : { connectionId },
        });
}

/** True when this call claimed the lease; false when another sync holds it. */
export async function claimSyncLease(connectionId: number): Promise<boolean> {
    const staleBefore = new Date(Date.now() - SYNC_LEASE_STALE_MS);
    const claimed = await db
        .update(googleDriveSyncState)
        .set({ syncLockedAt: new Date(), lastSyncStatus: "running" })
        .where(
            and(
                eq(googleDriveSyncState.connectionId, connectionId),
                or(
                    isNull(googleDriveSyncState.syncLockedAt),
                    lt(googleDriveSyncState.syncLockedAt, staleBefore)
                )
            )
        )
        .returning({ connectionId: googleDriveSyncState.connectionId });
    return claimed.length > 0;
}

export interface ReleaseSyncLeaseParams {
    readonly status: "ok" | "error";
    readonly error?: string | null;
    /** Persisted only on success — a failed run must re-see its changes. */
    readonly startPageToken?: string | null;
    readonly report?: Record<string, unknown> | null;
}

export async function releaseSyncLease(
    connectionId: number,
    params: ReleaseSyncLeaseParams
): Promise<void> {
    await db
        .update(googleDriveSyncState)
        .set({
            syncLockedAt: null,
            lastSyncAt: new Date(),
            lastSyncStatus: params.status,
            lastSyncError: params.error ?? null,
            ...(params.startPageToken ? { startPageToken: params.startPageToken } : {}),
            ...(params.report !== undefined ? { lastSyncReport: params.report } : {}),
        })
        .where(eq(googleDriveSyncState.connectionId, connectionId));
}

// ── Picked items ─────────────────────────────────────────────────────

export async function listPickedItems(connectionId: number): Promise<GoogleDrivePickedItem[]> {
    return db
        .select()
        .from(googleDrivePickedItem)
        .where(eq(googleDrivePickedItem.connectionId, connectionId))
        .orderBy(googleDrivePickedItem.name);
}

export interface PickedItemInput {
    readonly fileId: string;
    readonly kind: "file" | "folder";
    readonly name: string;
    readonly mimeType: string | null;
}

export async function addPickedItems(
    connectionId: number,
    items: readonly PickedItemInput[],
    addedByUserPk: number
): Promise<void> {
    if (items.length === 0) return;
    await db
        .insert(googleDrivePickedItem)
        .values(
            items.map(item => ({
                connectionId,
                fileId: item.fileId,
                kind: item.kind,
                name: item.name,
                mimeType: item.mimeType,
                addedByUserPk,
            }))
        )
        // Re-picking is how users refresh a drive.file folder grant, so the
        // same selection must converge, not error.
        .onConflictDoUpdate({
            target: [googleDrivePickedItem.connectionId, googleDrivePickedItem.fileId],
            set: {
                name: sql`excluded.name`,
                mimeType: sql`excluded.mime_type`,
                kind: sql`excluded.kind`,
            },
        });
}

export async function removePickedItems(
    connectionId: number,
    fileIds: readonly string[]
): Promise<void> {
    if (fileIds.length === 0) return;
    await db
        .delete(googleDrivePickedItem)
        .where(
            and(
                eq(googleDrivePickedItem.connectionId, connectionId),
                inArray(googleDrivePickedItem.fileId, [...fileIds])
            )
        );
}
