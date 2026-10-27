"use client";

/**
 * The Processing queue as the server tells it, kept fresh while anything is
 * watching: the Processing tab, and the tab strip's count beside its name.
 * One poller however many watchers there are.
 *
 * How often (see `nextQueuePollDelay`):
 * - every 2 s while a file is running, waiting or retrying, or a connector
 *   is syncing — a stage bar that moves once a minute is not a progress bar;
 * - when nothing is, 10 s, then half as long again each time up to a minute,
 *   so a teammate's upload or a background Drive sync still shows up;
 * - never while the browser tab is hidden; coming back asks at once.
 *
 * The request reads only the job's small columns and its stage rows (never
 * the page text), so 2 s is cheap.
 */

import { useCallback, useEffect, useSyncExternalStore } from "react";

import type { ProcessingQueueResponse } from "~/lib/processing-queue/types";

export const QUEUE_POLL = {
    activeMs: 2_000,
    idleInitialMs: 10_000,
    idleFactor: 1.5,
    idleMaxMs: 60_000,
    /** After a failed request: wait at least this, doubling, so an outage isn't hammered. */
    errorMinMs: 5_000,
} as const;

export const QUEUE_ENDPOINT = "/api/documents/processing-queue";

export interface QueueSnapshot {
    data: ProcessingQueueResponse | null;
    /** The last request's failure, in words; cleared by the next success. */
    error: string | null;
    /** True until the first answer (or failure). */
    loading: boolean;
}

/** Whether anything in this answer is still moving. */
export function queueIsActive(data: ProcessingQueueResponse | null): boolean {
    if (!data) return false;
    const { running, waiting, retrying } = data.summary;
    return (
        running + waiting + retrying > 0 ||
        data.connectors.some(connector => connector.status === "running")
    );
}

/**
 * The wait before the next poll. `idleTicks` counts polls in a row that found
 * nothing moving; `errorTicks` failures in a row.
 */
export function nextQueuePollDelay(state: {
    active: boolean;
    idleTicks: number;
    errorTicks: number;
}): number {
    if (state.errorTicks > 0) {
        return Math.min(QUEUE_POLL.errorMinMs * 2 ** (state.errorTicks - 1), QUEUE_POLL.idleMaxMs);
    }
    if (state.active) return QUEUE_POLL.activeMs;
    return Math.min(
        Math.round(QUEUE_POLL.idleInitialMs * QUEUE_POLL.idleFactor ** state.idleTicks),
        QUEUE_POLL.idleMaxMs
    );
}

let snapshot: QueueSnapshot = { data: null, error: null, loading: true };
const listeners = new Set<() => void>();
let watchers = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight: Promise<void> | null = null;
let idleTicks = 0;
let errorTicks = 0;
/** Something outside the answer says to keep the fast pace (an upload just handed off). */
let boostUntil = 0;

function set(next: QueueSnapshot) {
    snapshot = next;
    for (const listener of listeners) listener();
}

function hidden(): boolean {
    return typeof document !== "undefined" && document.visibilityState === "hidden";
}

function schedule() {
    if (timer) clearTimeout(timer);
    timer = null;
    if (watchers === 0 || hidden()) return;
    const active = queueIsActive(snapshot.data) || Date.now() < boostUntil;
    timer = setTimeout(() => void poll(), nextQueuePollDelay({ active, idleTicks, errorTicks }));
}

async function poll(): Promise<void> {
    if (inFlight) return inFlight;
    inFlight = (async () => {
        try {
            const res = await fetch(QUEUE_ENDPOINT, { cache: "no-store" });
            if (!res.ok) {
                const body = (await res.json().catch(() => ({}))) as { error?: string };
                throw new Error(
                    res.status === 429
                        ? "Checking too often — slowing down."
                        : (body.error ?? `The queue didn't load (HTTP ${res.status}).`)
                );
            }
            const data = (await res.json()) as ProcessingQueueResponse;
            errorTicks = 0;
            idleTicks = queueIsActive(data) ? 0 : idleTicks + 1;
            set({ data, error: null, loading: false });
        } catch (err) {
            errorTicks += 1;
            set({
                ...snapshot,
                loading: false,
                error: err instanceof Error ? err.message : "The queue didn't load.",
            });
        } finally {
            inFlight = null;
            schedule();
        }
    })();
    return inFlight;
}

function onVisibility() {
    if (hidden()) {
        if (timer) clearTimeout(timer);
        timer = null;
    } else {
        void poll();
    }
}

function watch(): () => void {
    watchers += 1;
    if (watchers === 1) {
        if (typeof document !== "undefined") {
            document.addEventListener("visibilitychange", onVisibility);
        }
        void poll();
    }
    return () => {
        watchers -= 1;
        if (watchers > 0) return;
        if (timer) clearTimeout(timer);
        timer = null;
        if (typeof document !== "undefined") {
            document.removeEventListener("visibilitychange", onVisibility);
        }
    };
}

/**
 * Ask now, and keep the fast pace for a while even if the answer looks idle —
 * a file just handed to the server takes a moment to show up as a job.
 */
export function refreshProcessingQueue(boostMs = 20_000): Promise<void> {
    boostUntil = Math.max(boostUntil, Date.now() + boostMs);
    idleTicks = 0;
    if (watchers === 0) return Promise.resolve();
    return poll();
}

/** Replace the snapshot with a server answer (after a Retry), without waiting for a poll. */
export function patchProcessingQueue(
    fn: (data: ProcessingQueueResponse) => ProcessingQueueResponse
) {
    if (!snapshot.data) return;
    set({ ...snapshot, data: fn(snapshot.data) });
}

function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

const SERVER: QueueSnapshot = { data: null, error: null, loading: true };

/**
 * The queue, polled while this is mounted with `enabled`. Several callers
 * share one poller.
 */
export function useProcessingQueue(enabled = true): QueueSnapshot & { refresh: () => void } {
    const value = useSyncExternalStore(
        subscribe,
        () => snapshot,
        () => SERVER
    );
    useEffect(() => (enabled ? watch() : undefined), [enabled]);
    const refresh = useCallback(() => void refreshProcessingQueue(), []);
    return { ...value, refresh };
}

/** Tests only. */
export function resetProcessingQueueForTests(): void {
    if (timer) clearTimeout(timer);
    timer = null;
    snapshot = { data: null, error: null, loading: true };
    watchers = 0;
    inFlight = null;
    idleTicks = 0;
    errorTicks = 0;
    boostUntil = 0;
}
