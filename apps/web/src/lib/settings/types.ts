/**
 * The vocabulary of the settings system, shared by the registry, the server
 * store, the API and the panel. Dependency-free on purpose so a client
 * component and a route handler describe a setting with the same words.
 */

import type { Permission } from "~/lib/authz/permissions";

/**
 * Where a value can come from, least specific first. Resolution walks the
 * ladder from the right: a member's own choice beats a folder's, a folder's
 * beats the workspace's, and the workspace's beats the product default.
 */
export const SETTING_SCOPES = ["default", "workspace", "folder", "member"] as const;
export type SettingScope = (typeof SETTING_SCOPES)[number];

/** Scopes that can hold a stored value. `default` lives in code. */
export type StoredScope = Exclude<SettingScope, "default">;

export function isStoredScope(value: unknown): value is StoredScope {
    return value === "workspace" || value === "folder" || value === "member";
}

/** Rail sections of the panel. Grouped into You / Workspace / Workspace data. */
export const SETTINGS_SECTION_IDS = [
    "account",
    "appearance",
    "shortcuts",
    "people",
    "company",
    "processing",
    "models",
    "agents",
    "documents",
    "integrations",
    "usage",
    "archive",
    "privacy",
    "labs",
] as const;
export type SettingsSectionId = (typeof SETTINGS_SECTION_IDS)[number];

export function isSettingsSectionId(value: unknown): value is SettingsSectionId {
    return typeof value === "string" && (SETTINGS_SECTION_IDS as readonly string[]).includes(value);
}

export interface SettingOption<T = unknown> {
    value: T;
    label: string;
    description?: string;
}

/** How the generic row renders a setting. Rich sections bring their own UI. */
export type SettingControl =
    | { kind: "switch" }
    | { kind: "select"; options: readonly SettingOption[] }
    | { kind: "radio"; options: readonly SettingOption[] }
    | { kind: "number"; min?: number; max?: number; step?: number; unit?: string }
    | { kind: "text"; placeholder?: string };

/**
 * One resolved setting as the API hands it to the client: the effective
 * value, where it came from, and which scopes the viewer may write.
 */
export interface ResolvedSetting<T = unknown> {
    key: string;
    value: T;
    /** The scope whose value won. `default` means nothing is stored anywhere. */
    source: SettingScope;
    /** Folder path or member id the winning value belongs to; null for workspace/default. */
    sourceId: string | null;
    /** Who last wrote the winning value, when it is stored. */
    updatedBy: string | null;
    updatedAt: string | null;
    /** Scopes this viewer may write, given the definition and their permissions. */
    canEdit: Record<StoredScope, boolean>;
    /** The value at each stored scope that has one, so the row can show what a reset restores. */
    stored: Partial<Record<StoredScope, T>>;
}

export interface SettingsViewer {
    authUserId: string;
    permissions: readonly Permission[];
}

export interface SettingsPayload {
    settings: Record<string, ResolvedSetting>;
    viewer: SettingsViewer;
    /** The folder the folder-scoped values were resolved for, when one was asked for. */
    folder: string | null;
}

export interface SettingWriteRequest {
    key: string;
    scope: StoredScope;
    /** Folder path for `folder`, ignored for `workspace`, defaults to the viewer for `member`. */
    scopeId?: string | null;
    /** Omitted when `reset` is true. */
    value?: unknown;
    /** Remove the stored value at `scope` so the row inherits again. */
    reset?: boolean;
}
