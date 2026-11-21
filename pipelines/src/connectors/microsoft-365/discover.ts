/**
 * Picked items → discovered knowledge items, without downloading anything.
 *
 * Folders are walked recursively; "shared with me" entries resolve to the
 * item in the drive it really lives in; every file gets a fingerprint from
 * listing metadata alone (its cTag, which changes only with content), so an
 * unchanged corpus costs one listing pass and zero downloads.
 *
 * Each item remembers which picked item it came through and the subfolders
 * between that and the file, so the host can rebuild the folder tree. The
 * walk also says whether it saw everything (`complete`): a folder it could
 * not read hides files that are still there, and the sync must not call
 * those missing.
 */

import type { DiscoveredKnowledgeItem, SkippedKnowledgeItem } from "../types";
import { Microsoft365AccessError, type GraphDriveItem, type Microsoft365Client } from "./client";
import { resolveMicrosoft365Action, type Microsoft365Action } from "./export-rules";

export const MICROSOFT_365_CONNECTOR_ID = "microsoft-365";

export const DEFAULT_MAX_ITEMS = 2000;

export interface PickedMicrosoft365Item {
    readonly driveId: string;
    /** A drive item id, or `"root"` for the whole drive. */
    readonly itemId: string;
    readonly kind: "file" | "folder";
}

/** An item's identity across syncs: the drive it lives in plus its id there. */
export function microsoft365SourceId(driveId: string, itemId: string): string {
    return `${driveId}:${itemId}`;
}

/** The inverse of {@link microsoft365SourceId}; null for anything else. */
export function parseMicrosoft365SourceId(
    sourceId: string
): { readonly driveId: string; readonly itemId: string } | null {
    const colon = sourceId.indexOf(":");
    if (colon <= 0 || colon === sourceId.length - 1) return null;
    return { driveId: sourceId.slice(0, colon), itemId: sourceId.slice(colon + 1) };
}

export type Microsoft365ContentAction = Extract<Microsoft365Action, { action: "download" }>;

/**
 * What the host needs to file an item and link back to it. `pickedRoot` is
 * the source id of the picked item it was reached through (itself, for a
 * picked file); `folderPath` the subfolder names between that folder and the
 * file (empty at its top); `parentPath` where it sits in its own drive.
 */
export interface Microsoft365ItemMetadata {
    readonly driveId: string;
    readonly itemId: string;
    /** Opens the file in OneDrive or SharePoint; null when Graph sent none. */
    readonly webUrl: string | null;
    /** Folder path inside the drive, e.g. `/Clients/Acme`; `/` at the drive's root. */
    readonly parentPath: string;
    readonly pickedRoot: string;
    readonly folderPath: readonly string[];
    /** The MIME type Graph reported, before any filename fallback. */
    readonly graphMimeType: string | null;
}

export interface Microsoft365DiscoveredItem extends DiscoveredKnowledgeItem {
    readonly driveItem: GraphDriveItem;
    readonly driveId: string;
    readonly contentAction: Microsoft365ContentAction;
}

export interface Microsoft365Discovery {
    readonly items: readonly Microsoft365DiscoveredItem[];
    readonly skipped: readonly SkippedKnowledgeItem[];
    /** Source ids that answered 403/404 — deleted, or access to them is gone. */
    readonly accessLost: readonly string[];
    /** Picked folders (as source ids) whose listing came back with nothing in it. */
    readonly emptyFolders: readonly string[];
    readonly truncated: boolean;
    /**
     * False when some folder could not be read to its end (access lost, an
     * error, nesting too deep, or the item cap). What the walk did not reach
     * may still exist.
     */
    readonly complete: boolean;
}

export interface DiscoverMicrosoft365Options {
    readonly client: Microsoft365Client;
    readonly pickedItems: readonly PickedMicrosoft365Item[];
    readonly maxItems?: number;
}

/**
 * Change-detection identity from listing metadata. Prefixed so a later switch
 * of fingerprint source can never collide with an old value.
 */
export function microsoft365Fingerprint(item: GraphDriveItem): string {
    if (item.cTag) return `ctag:${item.cTag}`;
    const hashes = item.file?.hashes;
    if (hashes?.quickXorHash) return `qxh:${hashes.quickXorHash}`;
    if (hashes?.sha256Hash) return `sha256:${hashes.sha256Hash}`;
    if (item.eTag) return `etag:${item.eTag}`;
    return `mod:${item.size ?? "unknown"}:${item.lastModifiedDateTime ?? "unknown"}`;
}

export function describeError(error: unknown): string {
    if (error instanceof Error) return `${error.name}: ${error.message}`;
    return String(error);
}

/** `/drives/{id}/root:/Clients/Acme` → `/Clients/Acme`. */
function parentPathOf(item: GraphDriveItem): string {
    const raw = item.parentReference?.path;
    if (!raw) return "/";
    const marker = raw.indexOf("root:");
    const tail = marker === -1 ? raw : raw.slice(marker + "root:".length);
    let decoded = tail;
    try {
        decoded = decodeURIComponent(tail);
    } catch {
        decoded = tail;
    }
    return decoded.startsWith("/") ? decoded : `/${decoded}`;
}

interface WalkPosition {
    readonly path: string;
    readonly depth: number;
    /** Source id of the picked item this walk started from. */
    readonly rootId: string;
    readonly folders: readonly string[];
}

function toDiscoveredItem(
    item: GraphDriveItem,
    driveId: string,
    at: WalkPosition,
    action: Microsoft365ContentAction
): Microsoft365DiscoveredItem {
    const sourceId = microsoft365SourceId(driveId, item.id);
    const metadata: Microsoft365ItemMetadata = {
        driveId,
        itemId: item.id,
        webUrl: item.webUrl ?? null,
        parentPath: parentPathOf(item),
        pickedRoot: at.rootId,
        folderPath: at.folders,
        graphMimeType: item.file?.mimeType ?? null,
    };
    return {
        sourceId,
        connectorId: MICROSOFT_365_CONNECTOR_ID,
        title: item.name,
        kind: "microsoft-365-file",
        mimeType: action.mimeType,
        bytes: item.size ?? 0,
        modifiedAt: item.lastModifiedDateTime ?? "",
        location: {
            origin: item.webUrl ?? sourceId,
            relativePath: at.path,
        },
        metadata: { ...metadata },
        driveItem: item,
        driveId,
        contentAction: action,
    };
}

export async function discoverMicrosoft365Items(
    options: DiscoverMicrosoft365Options
): Promise<Microsoft365Discovery> {
    const { client, pickedItems } = options;
    const maxItems = options.maxItems ?? DEFAULT_MAX_ITEMS;

    const items: Microsoft365DiscoveredItem[] = [];
    const skipped: SkippedKnowledgeItem[] = [];
    const accessLost: string[] = [];
    const emptyFolders: string[] = [];
    const visited = new Set<string>();
    let truncated = false;
    let complete = true;

    function atCapacity(): boolean {
        if (items.length < maxItems) return false;
        truncated = true;
        return true;
    }

    /** A folder the walk could not see into: report it, and stop trusting absences. */
    function folderFailed(sourceId: string, error: unknown): void {
        complete = false;
        if (error instanceof Microsoft365AccessError) accessLost.push(sourceId);
        else skipped.push({ sourceId, reason: "unreadable", detail: describeError(error) });
    }

    /**
     * A single file the walk could not look up. Gone-or-forbidden is an
     * answer (`accessLost`); any other error is not, so absences stop counting.
     */
    function fileFailed(sourceId: string, error: unknown): void {
        if (error instanceof Microsoft365AccessError) {
            accessLost.push(sourceId);
            return;
        }
        complete = false;
        skipped.push({ sourceId, reason: "unreadable", detail: describeError(error) });
    }

    async function visitItem(
        item: GraphDriveItem,
        driveId: string,
        at: WalkPosition
    ): Promise<void> {
        const sourceId = microsoft365SourceId(driveId, item.id);
        if (visited.has(sourceId)) return;
        visited.add(sourceId);

        const action = resolveMicrosoft365Action(item);
        switch (action.action) {
            case "recurse":
                try {
                    await visitFolder(item, driveId, at);
                } catch (error) {
                    // The picked folder is reported under the id it was picked by.
                    folderFailed(at.depth === 0 ? at.rootId : sourceId, error);
                }
                return;
            case "resolve-remote": {
                const remote = item.remoteItem;
                const targetDrive = remote?.parentReference?.driveId;
                const targetId = remote?.id;
                if (!targetDrive || !targetId) {
                    skipped.push({
                        sourceId,
                        reason: "unreadable",
                        detail: "shared item without a target",
                    });
                    return;
                }
                const targetSourceId = microsoft365SourceId(targetDrive, targetId);
                try {
                    await visitItem(await client.getItem(targetDrive, targetId), targetDrive, at);
                } catch (error) {
                    if (remote.folder) folderFailed(targetSourceId, error);
                    else fileFailed(targetSourceId, error);
                }
                return;
            }
            case "skip":
                skipped.push({ sourceId, reason: "excluded", detail: action.reason });
                return;
            case "download":
                if (atCapacity()) {
                    skipped.push({ sourceId, reason: "limit-reached" });
                    return;
                }
                items.push(toDiscoveredItem(item, driveId, at, action));
        }
    }

    async function visitFolder(
        folder: GraphDriveItem,
        driveId: string,
        at: WalkPosition
    ): Promise<void> {
        // OneDrive allows deep nesting but a runaway walk should fail visibly,
        // not hang a sync.
        if (at.depth > 20) {
            complete = false;
            skipped.push({
                sourceId: microsoft365SourceId(driveId, folder.id),
                reason: "excluded",
                detail: "folder nesting deeper than 20 levels",
            });
            return;
        }
        // The picked folder (or a picked shared folder's target) is the root
        // of the rebuilt tree; only the folders beneath it become subfolders.
        const isRoot = at.depth === 0;
        const folders = isRoot ? at.folders : [...at.folders, folder.name];
        let nextLink: string | undefined;
        let sawAny = false;
        do {
            const page = await client.listChildren(driveId, folder.id, nextLink);
            if (page.value.length > 0) sawAny = true;
            for (const child of page.value) {
                if (truncated) return;
                // Graph is loose about drive-id casing between endpoints; the
                // id the walk came in on wins unless the child truly lives
                // elsewhere.
                const reported = child.parentReference?.driveId;
                const childDrive =
                    reported && reported.toLowerCase() !== driveId.toLowerCase()
                        ? reported
                        : driveId;
                await visitItem(child, childDrive, {
                    path: at.path ? `${at.path}/${child.name}` : child.name,
                    depth: at.depth + 1,
                    rootId: at.rootId,
                    folders,
                });
            }
            nextLink = page["@odata.nextLink"];
        } while (nextLink && !truncated);
        if (isRoot && !sawAny) emptyFolders.push(at.rootId);
    }

    for (const picked of pickedItems) {
        const rootId = microsoft365SourceId(picked.driveId, picked.itemId);
        try {
            const item = await client.getItem(picked.driveId, picked.itemId);
            await visitItem(item, picked.driveId, {
                path: item.name,
                depth: 0,
                rootId,
                folders: [],
            });
        } catch (error) {
            if (picked.kind === "folder") folderFailed(rootId, error);
            else fileFailed(rootId, error);
        }
    }

    return {
        items,
        skipped,
        accessLost,
        emptyFolders,
        truncated,
        complete: complete && !truncated,
    };
}
