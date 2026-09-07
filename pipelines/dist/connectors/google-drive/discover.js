/**
 * Picked items → discovered knowledge items, without downloading anything.
 *
 * Folders are walked recursively; shortcuts resolve to their targets; every
 * file gets a fingerprint from listing metadata alone (md5Checksum for
 * binaries, headRevisionId for Google-native files), so an unchanged corpus
 * costs one listing pass and zero downloads.
 */
import { DriveAccessError } from "./client.js";
import { resolveDriveAction } from "./export-rules.js";
export const GOOGLE_DRIVE_CONNECTOR_ID = "google-drive";
export const DEFAULT_MAX_ITEMS = 2000;
/**
 * Change-detection identity from listing metadata. Prefixed so a later switch
 * of fingerprint source can never collide with an old value.
 */
export function driveFingerprint(file) {
    if (file.md5Checksum)
        return `md5:${file.md5Checksum}`;
    if (file.headRevisionId)
        return `rev:${file.headRevisionId}`;
    if (file.version)
        return `ver:${file.version}`;
    return `mod:${file.modifiedTime ?? "unknown"}`;
}
export function describeError(error) {
    if (error instanceof Error)
        return `${error.name}: ${error.message}`;
    return String(error);
}
function toDiscoveredItem(file, path, action) {
    const ingestionMime = action.action === "export" ? action.exportMime : file.mimeType;
    return {
        sourceId: file.id,
        connectorId: GOOGLE_DRIVE_CONNECTOR_ID,
        title: file.name,
        kind: "drive-file",
        mimeType: ingestionMime,
        bytes: Number(file.size ?? 0),
        modifiedAt: file.modifiedTime ?? "",
        location: {
            origin: `https://drive.google.com/file/d/${file.id}`,
            relativePath: path,
        },
        metadata: {
            driveFileId: file.id,
            driveMimeType: file.mimeType,
            exportMime: action.action === "export" ? action.exportMime : null,
            extension: action.action === "export" ? action.extension : null,
        },
        driveFile: file,
        contentAction: action,
    };
}
export async function discoverDriveItems(options) {
    const { client, pickedItems } = options;
    const maxItems = options.maxItems ?? DEFAULT_MAX_ITEMS;
    const items = [];
    const skipped = [];
    const accessLost = [];
    const visited = new Set();
    let truncated = false;
    function atCapacity() {
        if (items.length < maxItems)
            return false;
        truncated = true;
        return true;
    }
    async function visitFile(file, path, depth) {
        if (visited.has(file.id))
            return;
        visited.add(file.id);
        if (file.trashed) {
            skipped.push({ sourceId: file.id, reason: "excluded", detail: "trashed" });
            return;
        }
        const action = resolveDriveAction(file);
        switch (action.action) {
            case "recurse":
                await visitFolder(file.id, path, depth);
                return;
            case "resolve-shortcut": {
                const targetId = file.shortcutDetails?.targetId;
                if (!targetId) {
                    skipped.push({
                        sourceId: file.id,
                        reason: "unreadable",
                        detail: "shortcut without target",
                    });
                    return;
                }
                try {
                    await visitFile(await client.getFile(targetId), path, depth);
                }
                catch (error) {
                    if (error instanceof DriveAccessError)
                        accessLost.push(targetId);
                    else
                        skipped.push({
                            sourceId: targetId,
                            reason: "unreadable",
                            detail: describeError(error),
                        });
                }
                return;
            }
            case "skip":
                skipped.push({ sourceId: file.id, reason: "excluded", detail: action.reason });
                return;
            case "download":
            case "export":
                if (atCapacity()) {
                    skipped.push({ sourceId: file.id, reason: "limit-reached" });
                    return;
                }
                items.push(toDiscoveredItem(file, path, action));
        }
    }
    async function visitFolder(folderId, path, depth) {
        // Drive allows deep nesting but a runaway walk should fail visibly,
        // not hang a sync.
        if (depth > 20) {
            skipped.push({
                sourceId: folderId,
                reason: "excluded",
                detail: "folder nesting deeper than 20 levels",
            });
            return;
        }
        let pageToken;
        do {
            const page = await client.listChildren(folderId, pageToken);
            for (const child of page.files) {
                if (truncated)
                    return;
                await visitFile(child, path ? `${path}/${child.name}` : child.name, depth + 1);
            }
            pageToken = page.nextPageToken;
        } while (pageToken && !truncated);
    }
    for (const picked of pickedItems) {
        try {
            const file = await client.getFile(picked.fileId);
            await visitFile(file, file.name, 0);
        }
        catch (error) {
            if (error instanceof DriveAccessError)
                accessLost.push(picked.fileId);
            else
                skipped.push({
                    sourceId: picked.fileId,
                    reason: "unreadable",
                    detail: describeError(error),
                });
        }
    }
    return { items, skipped, accessLost, truncated };
}
//# sourceMappingURL=discover.js.map