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
import { useTranslations } from "next-intl";

import { isAgentAutonomy } from "~/lib/agents/autonomy";
import { isAgentStyle } from "~/lib/agents/definition";
import {
    autonomyDescription,
    autonomyLabel,
    styleDescription,
    styleLabel,
} from "~/lib/agents/i18n";

import {
    getSetting,
    searchSettings,
    settingOptionKey,
    type SettingDefinition,
    type SettingSearchCopy,
} from "./registry";
import {
    SETTING_SCOPES,
    type ResolvedSetting,
    type SettingOption,
    type SettingScope,
    type SettingWriteRequest,
    type SettingsPayload,
    type StoredScope,
} from "./types";

export interface SettingsSnapshot {
    loaded: boolean;
    /** Why the last load failed, in the reader's language (or the server's own sentence). */
    error: string | null;
    payload: SettingsPayload | null;
}

/**
 * Why a load failed, kept as data in the module store so the hook can say
 * it in the reader's language. `server` and `thrown` carry a sentence that
 * is shown as it came.
 */
type LoadProblem =
    | { kind: "server"; message: string }
    | { kind: "thrown"; message: string }
    | { kind: "signedOut" }
    | { kind: "status"; status: number }
    | { kind: "shape" }
    | { kind: "failed" };

interface StoredSnapshot {
    loaded: boolean;
    problem: LoadProblem | null;
    payload: SettingsPayload | null;
}

const INITIAL: StoredSnapshot = Object.freeze({ loaded: false, problem: null, payload: null });

const snapshots = new Map<string, StoredSnapshot>();
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

function snapshotFor(folder: string): StoredSnapshot {
    return snapshots.get(folder) ?? INITIAL;
}

function setSnapshot(folder: string, next: StoredSnapshot): void {
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
                    problem: body.error
                        ? { kind: "server", message: body.error }
                        : res.status === 401
                          ? { kind: "signedOut" }
                          : { kind: "status", status: res.status },
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
                    problem: { kind: "shape" },
                    payload: current.payload,
                });
                return;
            }
            setSnapshot(folder, { loaded: true, problem: null, payload });
        } catch (err) {
            setSnapshot(folder, {
                loaded: true,
                problem:
                    err instanceof Error
                        ? { kind: "thrown", message: err.message }
                        : { kind: "failed" },
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

/**
 * A failed write. `serverMessage` is the server's own sentence, shown as it
 * came; without one the row says "could not save" with the status.
 */
export class SettingWriteError extends Error {
    constructor(
        readonly status: number,
        readonly serverMessage: string | null
    ) {
        super(serverMessage ?? `Could not save the setting (${status}).`);
        this.name = "SettingWriteError";
    }
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
        throw new SettingWriteError(res.status, body.error ?? null);
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
    const t = useTranslations("settings.store");
    const cacheKey = keyFor(folder);
    const snap = useSyncExternalStore(
        subscribe,
        () => snapshotFor(cacheKey),
        () => INITIAL
    );
    useEffect(() => {
        void load(cacheKey);
    }, [cacheKey, snap.loaded]);
    const { loaded, problem, payload } = snap;
    return useMemo(() => {
        let error: string | null = null;
        if (problem) {
            switch (problem.kind) {
                case "server":
                case "thrown":
                    error = problem.message;
                    break;
                case "signedOut":
                    error = t("signedOut");
                    break;
                case "status":
                    error = t("loadFailedStatus", { status: problem.status });
                    break;
                case "shape":
                    error = t("unexpectedShape");
                    break;
                case "failed":
                    error = t("loadFailed");
                    break;
            }
        }
        return { loaded, error, payload };
    }, [loaded, problem, payload, t]);
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

/**
 * What a row that writes at `scope` shows: the value `scope` and the scopes
 * under it resolve to, ignoring anything more specific. Without this the
 * workspace row of a setting someone has also set for themselves shows their
 * own choice and calls it the workspace's.
 */
export function settingAtScope<T>(
    definition: SettingDefinition<T>,
    resolved: ResolvedSetting<T> | null,
    scope: StoredScope
): { value: T; source: SettingScope } {
    if (!resolved) return { value: definition.default, source: "default" };
    const rank = (s: SettingScope) => SETTING_SCOPES.indexOf(s);
    if (rank(resolved.source) <= rank(scope)) {
        return { value: resolved.value, source: resolved.source };
    }
    for (const candidate of SETTING_SCOPES.slice(1, rank(scope) + 1).reverse()) {
        const stored = resolved.stored[candidate as StoredScope];
        if (stored !== undefined) return { value: stored, source: candidate };
    }
    return { value: definition.default, source: "default" };
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
    const t = useTranslations("settings.store");

    const write = useCallback(
        async (request: SettingWriteRequest) => {
            setSaving(true);
            try {
                await writeSettingValue(request);
                setSaveError(null);
            } catch (err) {
                setSaveError(
                    err instanceof SettingWriteError
                        ? (err.serverMessage ?? t("saveFailedStatus", { status: err.status }))
                        : err instanceof Error
                          ? err.message
                          : t("saveFailed")
                );
                throw err;
            } finally {
                setSaving(false);
            }
        },
        [t]
    );

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

// ---------------------------------------------------------------------------
// The registry's words in the reader's language
// ---------------------------------------------------------------------------

/** What a row, a rail or a search result shows for one setting. */
export interface SettingCopy extends SettingSearchCopy {
    consequence?: string;
    placeholder?: string;
    unit?: string;
    /** An option's label and description; the declared English when there is no message. */
    option: (option: SettingOption) => { label: string; description?: string };
}

/** A translator over keys computed from data; each lookup is guarded by `has`. */
interface LooseTranslator {
    (key: string): string;
    has: (key: string) => boolean;
}

/**
 * The registry declares its words in English — route handlers and the audit
 * log read them there. The reader's language comes from
 * `settings.registry.<setting key>` (`.label`, `.description`,
 * `.consequence`, `.placeholder`, `.unit`, `.options.<option key>.label`),
 * falling back to the English for anything without a message. The language
 * row's words are the `language` namespace's; the answer styles and autonomy
 * levels are the `agents` namespace's, the same words the Agents screens use.
 */
export function useSettingCopier(): (definition: SettingDefinition) => SettingCopy {
    const registry = useTranslations("settings.registry") as unknown as LooseTranslator;
    const language = useTranslations("language");
    const agents = useTranslations("agents");
    return useCallback(
        (definition: SettingDefinition): SettingCopy => {
            const base = definition.key;
            const pick = (field: string, fallback: string): string =>
                registry.has(`${base}.${field}`) ? registry(`${base}.${field}`) : fallback;
            const control = definition.control;
            const option = (entry: SettingOption) => {
                if (definition.key === "chat.responseStyle" && isAgentStyle(entry.value)) {
                    return {
                        label: styleLabel(agents, entry.value),
                        description:
                            entry.description === undefined
                                ? undefined
                                : styleDescription(agents, entry.value),
                    };
                }
                if (definition.key === "agents.defaultAutonomy" && isAgentAutonomy(entry.value)) {
                    return {
                        label: autonomyLabel(agents, entry.value),
                        description:
                            entry.description === undefined
                                ? undefined
                                : autonomyDescription(agents, entry.value),
                    };
                }
                const key = settingOptionKey(entry);
                const at = key ? `options.${key}` : null;
                return {
                    label: at ? pick(`${at}.label`, entry.label) : entry.label,
                    description:
                        entry.description === undefined
                            ? undefined
                            : at
                              ? pick(`${at}.description`, entry.description)
                              : entry.description,
                };
            };
            if (definition.key === "appearance.language") {
                return {
                    label: language("label"),
                    description: language("settingDescription"),
                    option,
                };
            }
            return {
                label: pick("label", definition.label),
                description: pick("description", definition.description),
                consequence:
                    definition.consequence === undefined
                        ? undefined
                        : pick("consequence", definition.consequence),
                placeholder:
                    control.kind === "text" && control.placeholder !== undefined
                        ? pick("placeholder", control.placeholder)
                        : undefined,
                unit:
                    control.kind === "number" && control.unit !== undefined
                        ? pick("unit", control.unit)
                        : undefined,
                option,
            };
        },
        [registry, language, agents]
    );
}

/** One setting's words in the reader's language. */
export function useSettingCopy(definition: SettingDefinition): SettingCopy {
    const copier = useSettingCopier();
    return useMemo(() => copier(definition), [copier, definition]);
}

/**
 * `searchSettings` that also matches what the reader sees: the translated
 * label and description, as well as the English and the aliases.
 */
export function useSettingsSearch(): (query: string, limit?: number) => SettingDefinition[] {
    const copier = useSettingCopier();
    return useCallback(
        (query: string, limit?: number) => searchSettings(query, limit, copier),
        [copier]
    );
}
