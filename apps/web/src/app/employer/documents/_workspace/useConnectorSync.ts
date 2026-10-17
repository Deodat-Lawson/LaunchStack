"use client";

/**
 * The sync-request lifecycle the Drive and Gmail panels share.
 *
 * "Sync now" only queues an Inngest event; the run starts when the worker
 * picks it up a few seconds later, or never, when the server's job runner is
 * down. So after a request the panel keeps polling until the run shows up
 * (status "running", or lastSyncAt moved) and, if it hasn't within
 * SYNC_STALL_AFTER_MS, says so instead of sitting on "Not synced yet".
 */

import { useCallback, useEffect, useRef, useState } from "react";

export interface SyncStatusFields {
    readonly lastSyncAt?: string | null;
    readonly lastSyncStatus?: string | null;
}

/** idle → starting (requested, not picked up) → running → idle; or stalled. */
export type SyncPhase = "idle" | "starting" | "running" | "stalled";

export const SYNC_POLL_MS = 3000;
export const SYNC_STALL_AFTER_MS = 90_000;

interface PendingRequest {
    /** lastSyncAt when the request was accepted; a new value means it ran. */
    readonly baseline: string | null;
    readonly stalled: boolean;
}

export function useConnectorSync(
    status: SyncStatusFields | null,
    refresh: () => Promise<unknown>,
    syncUrl: string
): { readonly phase: SyncPhase; readonly requestSync: () => Promise<boolean> } {
    const [pending, setPending] = useState<PendingRequest | null>(null);
    const running = status?.lastSyncStatus === "running";
    const lastSyncAt = status?.lastSyncAt ?? null;
    // Read through a ref so a requestSync captured before a refresh (the
    // panels refresh, then request) still takes the current baseline.
    const lastSyncAtRef = useRef(lastSyncAt);
    useEffect(() => {
        lastSyncAtRef.current = lastSyncAt;
    }, [lastSyncAt]);

    // The run is visible: underway, or already finished between two polls.
    // A stalled request clears too, if the runner catches up later.
    useEffect(() => {
        if (pending && (running || lastSyncAt !== pending.baseline)) setPending(null);
    }, [pending, running, lastSyncAt]);

    const waiting = pending !== null && !pending.stalled;

    useEffect(() => {
        if (!running && !waiting) return;
        const id = setInterval(() => void refresh(), SYNC_POLL_MS);
        return () => clearInterval(id);
    }, [running, waiting, refresh]);

    useEffect(() => {
        if (!waiting) return;
        const id = setTimeout(
            () => setPending(prev => (prev ? { ...prev, stalled: true } : prev)),
            SYNC_STALL_AFTER_MS
        );
        return () => clearTimeout(id);
    }, [waiting]);

    const requestSync = useCallback(async (): Promise<boolean> => {
        const res = await fetch(syncUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
        });
        if (!res.ok) return false;
        setPending({ baseline: lastSyncAtRef.current, stalled: false });
        return true;
    }, [syncUrl]);

    const phase: SyncPhase = running
        ? "running"
        : pending
          ? pending.stalled
              ? "stalled"
              : "starting"
          : "idle";
    return { phase, requestSync };
}

/** The one-line sync state shown beside the account name. */
export function syncStatusLabel(phase: SyncPhase, lastSyncAt: string | null | undefined): string {
    if (phase === "running") return "Syncing…";
    if (phase === "starting") return "Starting sync…";
    if (lastSyncAt) return `Last sync ${new Date(lastSyncAt).toLocaleString()}`;
    return "Not synced yet";
}
