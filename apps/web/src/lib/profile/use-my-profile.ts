"use client";

/**
 * The signed-in person's profile, shared by every component that shows it.
 *
 * One module-level store rather than a fetch per component: the avatar in
 * the header and the editor in Settings read the same object, so saving a
 * photo in one repaints the other with no reload.
 *
 * Every mount revalidates (components mounting together share one request).
 * The profile depends on the active workspace, and client-side navigation
 * keeps this module alive across a switch, so a time-based "fresh enough"
 * window would let one workspace's look survive into the next. Anything that
 * changes the active workspace also calls `resetMyProfile()` before it
 * navigates, so the old look is never shown while the new one loads.
 */

import { useEffect, useSyncExternalStore } from "react";

import type { MyProfile } from "./resolve";
import { resetPeopleCache } from "./use-people";

interface State {
    data: MyProfile | null;
    error: string | null;
    loaded: boolean;
}

const EMPTY: State = { data: null, error: null, loaded: false };

let state: State = EMPTY;
let inflight: Promise<MyProfile | null> | null = null;
/** Bumped by `resetMyProfile`; a response from an older generation is dropped. */
let generation = 0;
const listeners = new Set<() => void>();

function emit(next: Partial<State>) {
    state = { ...state, ...next };
    for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function refreshMyProfile(): Promise<MyProfile | null> {
    const started = generation;
    const current = (inflight ??= fetch("/api/profile", { cache: "no-store" })
        .then(async response => {
            if (started !== generation) return null;
            if (!response.ok) {
                const body = (await response.json().catch(() => ({}))) as { error?: string };
                // 401/404 are "no profile yet", not an error worth showing.
                emit({
                    loaded: true,
                    error:
                        response.status >= 500
                            ? (body.error ?? "Could not load your profile.")
                            : null,
                });
                return null;
            }
            const data = (await response.json()) as MyProfile;
            if (started !== generation) return null;
            setMyProfile(data);
            return data;
        })
        .catch(() => {
            if (started === generation) {
                emit({ loaded: true, error: "Could not load your profile." });
            }
            return null;
        })
        .finally(() => {
            if (inflight === current) inflight = null;
        }));
    return current;
}

/** Replaces the cached profile with a server response (every write route returns one). */
export function setMyProfile(data: MyProfile) {
    // Other people can look different in another workspace; drop their looks
    // when this tab's active workspace changes.
    if (state.data && state.data.workspace?.id !== data.workspace?.id) resetPeopleCache();
    emit({ data, error: null, loaded: true });
}

/**
 * Forget the cached profile (and other people's looks). Call it when the
 * active workspace is about to change — switching, creating or joining one —
 * so the next screen loads its own look instead of showing the last one's.
 */
export function resetMyProfile() {
    generation += 1;
    inflight = null;
    resetPeopleCache();
    state = EMPTY;
    for (const listener of listeners) listener();
}

/** `enabled: false` reads the cache without fetching — for chrome that renders signed out too. */
export function useMyProfile({ enabled = true }: { enabled?: boolean } = {}): State {
    const snapshot = useSyncExternalStore(
        subscribe,
        () => state,
        () => state
    );
    useEffect(() => {
        if (enabled) void refreshMyProfile();
    }, [enabled]);
    return snapshot;
}

/**
 * Sends a profile write and folds the response into the store. Throws the
 * server's `{ error }` sentence on failure.
 */
export async function sendProfileWrite(input: string, init: RequestInit): Promise<MyProfile> {
    const response = await fetch(input, init);
    const body = (await response.json().catch(() => ({}))) as MyProfile & { error?: string };
    if (!response.ok) throw new Error(body.error ?? "Could not save your profile.");
    setMyProfile(body);
    return body;
}
