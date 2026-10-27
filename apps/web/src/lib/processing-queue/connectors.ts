/**
 * A connector's sync state row as the Processing queue shows it: a sync that
 * is running now, or one that finished in the last few minutes (its counts
 * say how many files it handed to the queue). Pure, so the window rules are
 * unit-tested.
 */

import type { ConnectorSyncProvider, ConnectorSyncSummary } from "./types";

/** A finished sync stays on the tab this long. */
export const RECENT_SYNC_WINDOW_MS = 15 * 60 * 1000;

/**
 * A `running` row whose lease is older than this belongs to a sync that died
 * mid-run — mirrors SYNC_LEASE_STALE_MS in the Drive and Gmail sync stores,
 * after which the next sync may take the lease over.
 */
export const SYNC_LEASE_STALE_MS = 10 * 60 * 1000;

export interface ConnectorSyncRow {
    provider: ConnectorSyncProvider;
    account: string | null;
    lastSyncStatus: string | null;
    lastSyncAt: Date | null;
    lastSyncError: string | null;
    lastSyncReport: Record<string, unknown> | null;
    syncLockedAt: Date | null;
}

function count(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value) && value >= 0
        ? Math.floor(value)
        : 0;
}

function reportOf(raw: Record<string, unknown> | null): ConnectorSyncSummary["report"] {
    if (!raw || typeof raw !== "object") return null;
    return {
        discovered: count(raw.discovered),
        stored: count(raw.stored),
        unchanged: count(raw.unchanged),
        skipped: count(raw.skipped),
        failed: count(raw.failed),
    };
}

/** The summary for one sync state row, or null when it is neither running nor recent. */
export function connectorSyncSummary(
    row: ConnectorSyncRow,
    now: Date
): ConnectorSyncSummary | null {
    const nowMs = now.getTime();
    if (row.lastSyncStatus === "running") {
        const lockedAt = row.syncLockedAt?.getTime();
        if (lockedAt === undefined || nowMs - lockedAt > SYNC_LEASE_STALE_MS) return null;
        return {
            provider: row.provider,
            account: row.account,
            status: "running",
            lastSyncAt: row.syncLockedAt!.toISOString(),
            // The previous run's counts; this run's land when it finishes.
            report: reportOf(row.lastSyncReport),
            error: null,
        };
    }
    if (row.lastSyncStatus !== "ok" && row.lastSyncStatus !== "error") return null;
    if (!row.lastSyncAt || nowMs - row.lastSyncAt.getTime() > RECENT_SYNC_WINDOW_MS) return null;
    return {
        provider: row.provider,
        account: row.account,
        status: row.lastSyncStatus,
        lastSyncAt: row.lastSyncAt.toISOString(),
        report: reportOf(row.lastSyncReport),
        error: row.lastSyncStatus === "error" ? (row.lastSyncError ?? null) : null,
    };
}
