/**
 * Where an imported Obsidian vault lands, and why nobody else sees it.
 *
 * Same model as Gmail (see ../private-folder.ts): a vault is one person's
 * notes, so `Obsidian/<vault>` is restricted with a single `manage` grant to
 * whoever imported it, who can share it when they choose to. The vault's own
 * folders are rebuilt beneath it and inherit its audience.
 *
 * Two people may both have a vault called "Notes": the second gets
 * `Obsidian/Notes (2)`, found again on every re-import by its grant.
 */

import {
    FOLDER_SEPARATOR,
    MAX_FOLDER_DEPTH,
    MAX_FOLDER_PATH_CHARS,
    splitFolderPath,
} from "~/lib/folders/path";
import { createFolder } from "~/server/folders";
import type { OwnerRef } from "~/server/workspace/ownership";

import {
    claimPrivateFolder,
    cleanFolderSegment,
    hasManageGrant,
    privateFolderPath,
} from "../private-folder";

export const OBSIDIAN_ROOT_FOLDER = "Obsidian";

export function vaultFolderFor(vaultName: string, attempt = 1): string {
    return privateFolderPath(OBSIDIAN_ROOT_FOLDER, vaultName, "Vault", attempt);
}

/**
 * A note's folder inside the vault folder, clamped to the folder limits: too
 * deep and the extra levels fold into the deepest allowed one, too long and
 * trailing folders are dropped.
 */
export function noteFolderPath(vaultPath: string, noteFolder: string): string {
    const base = splitFolderPath(vaultPath);
    const inner = splitFolderPath(noteFolder).map(segment => cleanFolderSegment(segment, "Folder"));
    const segments = [...base, ...inner].slice(0, MAX_FOLDER_DEPTH);
    while (
        segments.length > base.length &&
        segments.join(FOLDER_SEPARATOR).length > MAX_FOLDER_PATH_CHARS
    ) {
        segments.pop();
    }
    return segments.join(FOLDER_SEPARATOR);
}

/** `Obsidian/<vault>` for this person: theirs from an earlier import, or a new one. */
export async function ensureVaultFolder(owner: OwnerRef, vaultName: string): Promise<string> {
    const folder = await claimPrivateFolder({
        owner,
        root: OBSIDIAN_ROOT_FOLDER,
        name: vaultName,
        fallback: "Vault",
        // The importer's own vault of this name, found again by its grant.
        reuse: categoryId => hasManageGrant(categoryId, owner.userPk),
    });
    return folder.path;
}

/**
 * Creates the vault's subfolders as notes arrive. Serialized: notes are
 * stored several at a time, and two reaching the same new folder must not
 * both insert it.
 */
export function createNoteFolders(companyId: bigint, vaultPath: string) {
    const ensured = new Set<string>([vaultPath]);
    let queue: Promise<unknown> = Promise.resolve();
    return {
        async folderFor(noteFolder: string): Promise<string> {
            const path = noteFolderPath(vaultPath, noteFolder);
            if (ensured.has(path)) return path;
            const run = queue.then(async () => {
                if (ensured.has(path)) return;
                await createFolder(companyId, path);
                ensured.add(path);
            });
            queue = run.catch(() => undefined);
            await run;
            return path;
        },
    };
}
