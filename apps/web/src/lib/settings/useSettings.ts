"use client";

/**
 * The client's view of the settings API.
 *
 * One fetch of `/api/settings` per page load, shared by every component that
 * asks — the shell reads the theme and the shortcut map from the same answer
 * the panel edits, so there is one source of truth in the browser and it is
 * this module-level store (the same shape as `use-permissions`).
 *
 * Folder-scoped views are cached per folder path; a write at any scope marks
 * the other snapshots stale so they refetch on next use rather than showing a
 * value the server has already replaced.
 */

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { getSetting, type SettingDefinition } from "./registry";
import type { ResolvedSetting, SettingWriteRequest, SettingsPayload, StoredScope } from "./types";

export interface SettingsSnapshot {
    loaded: boolean;
    error: string | null;
    payload: SettingsPayload | null;
}

const INITIAL: SettingsSnapshot = Object.freeze({ loaded: false, error: null, payload: null });

const snapshots = new Map<string, SettingsSnapshot>();
const inflight = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();

function keyFor(folder: string | null | undefined): string {
    return folder?.trim() ? folder.trim() : "";
}

function emit(): void {
    for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

function snapshotFor(folder: string): SettingsSnapshot {
    return snapshots.get(folder) ?? INITIAL;
}

function setSnapshot(folder: string, next: SettingsSnapshot): void {
    snapshots.set(folder, next);
    emit();
}

async function load(folder: string, force = false): Promise<void> {
    const pending = inflight.get(folder);
    if (pending) return pending;
    const current = snapshotFor(folder);
    if (current.loaded && !force) return;
    const task = (async () => {
        try {
            const url = folder
                ? `/api/settings?folder=${encodeURIComponent(folder)}`
                : "/api/settings";
            const res = await fetch(url, { credentials: "same-origin" });
            if (!res.ok) {
                const body = (await res.json().catch(() => ({}))) as { error?: string };
                setSnapshot(folder, {
                    loaded: true,
                    error:
                        body.error ??
                        (res.status === 401
                            ? "You are signed out."
                            : `Could not load settings (${res.status}).`),
                    payload: current.payload,
                });
                return;
            }
            const payload = (await res.json().catch(() => null)) as SettingsPayload | null;
            // A proxy, a mock, or an older server can answer 200 with the wrong
            // shape; treat that as "no answer" rather than crash every reader.
            if (!payload || typeof payload !== "object" || typeof payload.settings !== "object") {
                setSnapshot(folder, {
                    loaded: true,
                    error: "The settings answer was not in the expected shape.",
                    payload: current.payload,
                });
                return;
            }
            setSnapshot(folder, { loaded: true, error: null, payload });
        } catch (err) {
            setSnapshot(folder, {
                loaded: true,
                error: err instanceof Error ? err.message : "Could not load settings.",
                payload: current.payload,
            });
        } finally {
            inflight.delete(folder);
        }
    })();
    inflight.set(folder, task);
    return task;
}

/** Forget every cached answer; the next reader refetches. */
export function invalidateSettings(): void {
    for (const [folder, snap] of snapshots) snapshots.set(folder, { ...snap, loaded: false });
    emit();
}

/** Test seam. */
export function resetSettingsForTests(): void {
    snapshots.clear();
    inflight.clear();
    listeners.clear();
}

/** Write one setting. Resolves to the server's view of the key, or throws with the server's sentence. */
export async function writeSettingValue(request: SettingWriteRequest): Promise<ResolvedSetting> {
    const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(request),
    });
    const body = (await res.json().catch(() => ({}))) as {
        setting?: ResolvedSetting;
        error?: string;
    };
    if (!res.ok || !body.setting) {
        throw new Error(body.error ?? `Could not save the setting (${res.status}).`);
    }
    const folder = request.scope === "folder" ? keyFor(request.scopeId) : "";
    // The answering folder view gets the fresh value; every other view is now
    // stale for this key and refetches when next read.
    for (const [cached, snap] of snapshots) {
        if (!snap.payload) continue;
        if (cached === folder) {
            snapshots.set(cached, {
                ...snap,
                payload: {
                    ...snap.payload,
                    settings: { ...snap.payload.settings, [body.setting.key]: body.setting },
                },
            });
        } else {
            snapshots.set(cached, { ...snap, loaded: false });
        }
    }
    emit();
    return body.setting;
}

export function useSettingsPayload(folder?: string | null): SettingsSnapshot {
    const cacheKey = keyFor(folder);
    const snap = useSyncExternalStore(
        subscribe,
        () => snapshotFor(cacheKey),
        () => INITIAL
    );
    useEffect(() => {
        void load(cacheKey);
    }, [cacheKey, snap.loaded]);
    return snap;
}

export interface UseSettingResult<T> {
    definition: SettingDefinition<T>;
    resolved: ResolvedSetting<T> | null;
    /** The effective value; the registry default until the server answers. */
    value: T;
    loaded: boolean;
    error: string | null;
    saving: boolean;
    /** The last write's failure, cleared by the next successful write. */
    saveError: string | null;
    /** Write at `scope` (defaults to the most specific scope the setting allows for this view). */
    set: (value: T, scope?: StoredScope, scopeId?: string | null) => Promise<void>;
    /** Remove the value at `scope` so the row inherits again. */
    reset: (scope?: StoredScope, scopeId?: string | null) => Promise<void>;
}

/** Which scope a plain `set()` writes, given the setting and whether a folder is in view. */
export function defaultWriteScope(
    definition: SettingDefinition,
    folder: string | null | undefined
): StoredScope {
    if (definition.scopes.includes("member")) return "member";
    if (folder && definition.scopes.includes("folder")) return "folder";
    return "workspace";
}

export function useSetting<T = unknown>(
    key: string,
    options: { folder?: string | null } = {}
): UseSettingResult<T> {
    const definition = getSetting(key) as SettingDefinition<T> | undefined;
    if (!definition) throw new Error(`Unknown setting "${key}"`);
    const folder = keyFor(options.folder);
    const snap = useSettingsPayload(folder);
    const resolved = (snap.payload?.settings?.[key] as ResolvedSetting<T> | undefined) ?? null;
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);

    const write = useCallback(async (request: SettingWriteRequest) => {
        setSaving(true);
        try {
            await writeSettingValue(request);
            setSaveError(null);
        } catch (err) {
            setSaveError(err instanceof Error ? err.message : "Could not save the setting.");
            throw err;
        } finally {
            setSaving(false);
        }
    }, []);

    const set = useCallback(
        async (value: T, scope?: StoredScope, scopeId?: string | null) => {
            const target = scope ?? defaultWriteScope(definition, folder);
            await write({
                key,
                scope: target,
                scopeId: target === "folder" ? (scopeId ?? folder) : (scopeId ?? null),
                value,
            });
        },
        [definition, folder, key, write]
    );

    const reset = useCallback(
        async (scope?: StoredScope, scopeId?: string | null) => {
            const target = scope ?? defaultWriteScope(definition, folder);
            await write({
                key,
                scope: target,
                scopeId: target === "folder" ? (scopeId ?? folder) : (scopeId ?? null),
                reset: true,
            });
        },
        [definition, folder, key, write]
    );

    return useMemo(
        () => ({
            definition,
            resolved,
            value: resolved ? resolved.value : definition.default,
            loaded: snap.loaded,
            error: snap.error,
            saving,
            saveError,
            set,
            reset,
        }),
        [definition, resolved, snap.loaded, snap.error, saving, saveError, set, reset]
    );
}

/** Read-only convenience for consumers that only need the effective value. */
export function useSettingValue<T = unknown>(key: string, folder?: string | null): T {
    return useSetting<T>(key, { folder }).value;
}
