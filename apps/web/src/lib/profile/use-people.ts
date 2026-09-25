"use client";

/**
 * How other people appear in the active workspace, looked up by auth id.
 *
 * For surfaces that only learn who is involved as data streams in (a meeting
 * transcript). Every id asked for in the same tick goes out as one request;
 * answers are cached for the page, including "not a member" (null), so a
 * long transcript costs one lookup per person, not per message. The cache is
 * dropped when the active workspace changes (`use-my-profile` calls
 * `resetPeopleCache`), since the same person can look different elsewhere.
 */

import { useEffect, useMemo, useSyncExternalStore } from "react";

import type { PersonLook } from "./resolve";

const CHUNK = 100;

let cache = new Map<string, PersonLook | null>();
const inflight = new Set<string>();
let queued = new Set<string>();
let scheduled = false;
let version = 0;
const listeners = new Set<() => void>();

function emit() {
    version += 1;
    for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

async function fetchChunk(ids: string[]) {
    try {
        const response = await fetch(
            `/api/profile/people?ids=${encodeURIComponent(ids.join(","))}`,
            {
                cache: "no-store",
            }
        );
        const body = response.ok
            ? ((await response.json()) as { people?: Record<string, PersonLook> })
            : {};
        for (const id of ids) cache.set(id, body.people?.[id] ?? null);
    } catch {
        // Unknown for this page load; the avatar falls back to initials. Not
        // retried per render, which would loop while the network is down.
        for (const id of ids) cache.set(id, null);
    } finally {
        for (const id of ids) inflight.delete(id);
        emit();
    }
}

function flush() {
    scheduled = false;
    const ids = [...queued];
    queued = new Set();
    for (const id of ids) inflight.add(id);
    for (let i = 0; i < ids.length; i += CHUNK) void fetchChunk(ids.slice(i, i + CHUNK));
}

function request(ids: readonly string[]) {
    for (const id of ids) {
        if (!id || cache.has(id) || inflight.has(id)) continue;
        queued.add(id);
    }
    if (queued.size > 0 && !scheduled) {
        scheduled = true;
        queueMicrotask(flush);
    }
}

export function resetPeopleCache() {
    cache = new Map();
    emit();
}

/** Looks for these ids; an id is absent until it resolves, and stays absent for non-members. */
export function usePeople(ids: readonly string[]): Record<string, PersonLook> {
    const key = [...new Set(ids)].sort().join(",");
    const tick = useSyncExternalStore(
        subscribe,
        () => version,
        () => version
    );
    useEffect(() => {
        request(key ? key.split(",") : []);
    }, [key, tick]);
    return useMemo(() => {
        const out: Record<string, PersonLook> = {};
        for (const id of key ? key.split(",") : []) {
            const look = cache.get(id);
            if (look) out[id] = look;
        }
        return out;
        // `tick` is the cache version: a resolved lookup must produce a new object.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key, tick]);
}
