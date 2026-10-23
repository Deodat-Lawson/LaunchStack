/**
 * The Drive panel's reading of `/api/connectors/google-drive/status`: the
 * payload's shape, and the pure decisions the panel makes from it — which
 * folder-access notice to show, which picked folders came back empty, and
 * where each picked item's files are. Kept out of the component so they can
 * be tested without rendering it.
 */

import { displayFolderPath } from "~/lib/folders/path";

export interface DrivePickedItem {
    readonly fileId: string;
    readonly kind: string;
    readonly name: string;
    readonly mimeType: string | null;
    /** A picked folder's LaunchStack folder; null until its first sync. */
    readonly folderPath?: string | null;
    /** Imported into a folder private to someone else, so its name isn't shown. */
    readonly folderHidden?: boolean;
}

export interface DriveStatus {
    readonly configured: boolean;
    readonly connected: boolean;
    readonly connectionId?: string;
    readonly status?: string;
    readonly accountEmail?: string | null;
    readonly pickedItems?: readonly DrivePickedItem[];
    readonly lastSyncAt?: string | null;
    readonly lastSyncStatus?: string | null;
    readonly lastSyncError?: string | null;
    readonly lastSyncReport?: Record<string, unknown> | null;
    readonly picker: {
        readonly apiKey: string | null;
        readonly appId: string | null;
        readonly scriptUrl: string;
    };
    /** `enabled`: the server may ask for folder access. `granted`: this connection holds it. */
    readonly folderAccess?: { readonly enabled: boolean; readonly granted: boolean };
}

/**
 * - `ready`: folders import whole.
 * - `allow`: the server can, but this connection only holds drive.file — the
 *   user opts in with "Allow folder access" (a second consent).
 * - `files-only`: the server can't (operator flag off): only picked files come in.
 */
export type FolderAccessState = "ready" | "allow" | "files-only";

export function folderAccessState(status: DriveStatus): FolderAccessState {
    if (status.folderAccess?.granted) return "ready";
    return status.folderAccess?.enabled ? "allow" : "files-only";
}

export function reportCount(
    report: Record<string, unknown> | null | undefined,
    key: string
): number {
    const value = report?.[key];
    if (typeof value === "number") return value;
    return Array.isArray(value) ? value.length : 0;
}

/** Picked folders the last sync listed and found nothing in, by name. */
export function emptyFolderNames(status: DriveStatus): string[] {
    const ids = status.lastSyncReport?.emptyFolders;
    if (!Array.isArray(ids) || ids.length === 0) return [];
    const byId = new Map((status.pickedItems ?? []).map(item => [item.fileId, item.name]));
    return ids.flatMap(id => {
        const name = typeof id === "string" ? byId.get(id) : undefined;
        return name ? [name] : [];
    });
}

/** The line under a picked item: where its files are in LaunchStack. */
export function pickedItemDestination(item: DrivePickedItem, access: FolderAccessState): string {
    if (item.kind !== "folder") return "In Google Drive";
    if (item.folderPath) return `In ${displayFolderPath(item.folderPath)}`;
    if (item.folderHidden) return "In a private folder of whoever picked it";
    return access === "ready"
        ? "Becomes its own folder on the next sync"
        : "Its contents need folder access";
}

/** "a", "a and b", "a, b and 2 more". */
export function listNames(names: readonly string[], max = 2): string {
    const quoted = names.map(name => `“${name}”`);
    if (quoted.length <= 1) return quoted[0] ?? "";
    if (quoted.length <= max) return `${quoted.slice(0, -1).join(", ")} and ${quoted.at(-1)}`;
    return `${quoted.slice(0, max).join(", ")} and ${quoted.length - max} more`;
}
