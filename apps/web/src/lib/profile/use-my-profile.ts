"use client";

/**
 * The signed-in person's profile, shared by every component that shows it.
 *
 * One module-level store rather than a fetch per component: the avatar in
 * the header and the editor in Settings read the same object, so saving a
 * photo in one repaints the other with no reload. A component mounting
 * revalidates in the background (at most once every few seconds), which is
 * also how the store follows a workspace switch — the new workspace's shell
 * mounts and asks again.
 */

import { useEffect, useSyncExternalStore } from "react";

import type { MyProfile } from "./resolve";
import { resetPeopleCache } from "./use-people";

interface State {
    data: MyProfile | null;
    error: string | null;
    loaded: boolean;
}

let state: State = { data: null, error: null, loaded: false };
let inflight: Promise<MyProfile | null> | null = null;
let fetchedAt = 0;
const listeners = new Set<() => void>();

const REVALIDATE_AFTER_MS = 3_000;

function emit(next: Partial<State>) {
    state = { ...state, ...next };
    for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function refreshMyProfile(): Promise<MyProfile | null> {
    inflight ??= fetch("/api/profile", { cache: "no-store" })
        .then(async response => {
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
            setMyProfile(data);
            return data;
        })
        .catch(() => {
            emit({ loaded: true, error: "Could not load your profile." });
            return null;
        })
        .finally(() => {
            fetchedAt = Date.now();
            inflight = null;
        });
    return inflight;
}

/** Replaces the cached profile with a server response (every write route returns one). */
export function setMyProfile(data: MyProfile) {
    // Other people can look different in another workspace; drop their looks
    // when this tab's active workspace changes.
    if (state.data && state.data.workspace?.id !== data.workspace?.id) resetPeopleCache();
    fetchedAt = Date.now();
    emit({ data, error: null, loaded: true });
}

/** `enabled: false` reads the cache without fetching — for chrome that renders signed out too. */
export function useMyProfile({ enabled = true }: { enabled?: boolean } = {}): State {
    const snapshot = useSyncExternalStore(
        subscribe,
        () => state,
        () => state
    );
    useEffect(() => {
        if (enabled && !inflight && Date.now() - fetchedAt > REVALIDATE_AFTER_MS) {
            void refreshMyProfile();
        }
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
