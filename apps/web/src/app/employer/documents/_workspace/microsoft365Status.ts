/**
 * The Microsoft 365 status (`/api/connectors/microsoft-files/status`) as Add
 * source's OneDrive and SharePoint panel and Settings' sync card read it:
 * the payload's shape, and the pure decisions made from it. Kept out of the
 * components so they can be tested without rendering.
 */

import type { useTranslations } from "next-intl";

import { displayFolderPath } from "~/lib/folders/path";
import type { DeletedHereSummary } from "./DeletedHereList";

/** `useTranslations("sources.microsoft365Sync")`. */
export type Microsoft365SyncTranslator = ReturnType<
    typeof useTranslations<"sources.microsoft365Sync">
>;

export interface Microsoft365PickedItem {
    /** `${driveId}:${itemId}`, the id the sync reports this pick by. */
    readonly sourceId: string;
    readonly driveId: string;
    readonly itemId: string;
    readonly kind: string;
    readonly name: string;
    readonly mimeType: string | null;
    /** Where it opens in OneDrive or SharePoint. */
    readonly webUrl?: string | null;
    /**
     * A picked folder's LaunchStack folder (null until its first sync); for a
     * file, the folder it was picked into.
     */
    readonly folderPath?: string | null;
    /** In a folder private to someone else, so its name isn't shown. */
    readonly folderHidden?: boolean;
}

export interface Microsoft365Status {
    readonly configured: boolean;
    readonly connected: boolean;
    readonly connectionId?: string;
    /** The connection's own status: `active`, or `revoked` when it needs reconnecting. */
    readonly status?: string;
    readonly accountEmail?: string | null;
    readonly pickedItems?: readonly Microsoft365PickedItem[];
    readonly lastSyncAt?: string | null;
    readonly lastSyncStatus?: string | null;
    readonly lastSyncError?: string | null;
    readonly lastSyncReport?: Record<string, unknown> | null;
    /** Files deleted here, which the sync leaves out (see DeletedHereList). */
    readonly deletedHere?: DeletedHereSummary;
}

/**
 * What a panel can offer right now.
 * - `forbidden`: the connection is the workspace's, and this person doesn't manage connections.
 * - `not-configured`: the server has no Microsoft app registration.
 * - `connect` / `reconnect`: Microsoft's consent comes first.
 * - `ready`: browse and paste.
 */
export type Microsoft365SourceState =
    | { readonly kind: "loading" }
    | { readonly kind: "forbidden" }
    | { readonly kind: "error" }
    | { readonly kind: "not-configured" }
    | { readonly kind: "connect" }
    | { readonly kind: "reconnect"; readonly accountEmail: string | null }
    | { readonly kind: "ready"; readonly accountEmail: string | null };

export type Microsoft365Loaded =
    | { readonly kind: "loading" }
    | { readonly kind: "forbidden" }
    | { readonly kind: "error" }
    | { readonly kind: "ok"; readonly status: Microsoft365Status };

export function microsoft365SourceState(loaded: Microsoft365Loaded): Microsoft365SourceState {
    if (loaded.kind !== "ok") return loaded;
    const status = loaded.status;
    if (!status.configured) return { kind: "not-configured" };
    if (!status.connected) return { kind: "connect" };
    const accountEmail = status.accountEmail ?? null;
    return status.status === "active"
        ? { kind: "ready", accountEmail }
        : { kind: "reconnect", accountEmail };
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
export function emptyFolderNames(status: Microsoft365Status): string[] {
    const ids = status.lastSyncReport?.emptyFolders;
    if (!Array.isArray(ids) || ids.length === 0) return [];
    const byId = new Map((status.pickedItems ?? []).map(item => [item.sourceId, item.name]));
    return ids.flatMap(id => {
        const name = typeof id === "string" ? byId.get(id) : undefined;
        return name ? [name] : [];
    });
}

/** The line under a picked item: where its files are in LaunchStack. */
export function pickedItemDestination(
    t: Microsoft365SyncTranslator,
    item: Microsoft365PickedItem
): string {
    if (item.folderPath) {
        return t("destination.inFolder", { path: displayFolderPath(item.folderPath) });
    }
    if (item.folderHidden) return t("destination.inPrivateFolder");
    return item.kind === "folder" ? t("destination.becomesFolder") : t("destination.inDefault");
}

/** "“a”", "“a” and “b”", "“a”, “b” and 2 more". */
export function listNames(t: Microsoft365SyncTranslator, names: readonly string[]): string {
    const [first, second] = names;
    if (first === undefined) return "";
    if (second === undefined) return t("names.one", { name: first });
    if (names.length === 2) return t("names.two", { first, second });
    return t("names.more", { first, second, count: names.length - 2 });
}
