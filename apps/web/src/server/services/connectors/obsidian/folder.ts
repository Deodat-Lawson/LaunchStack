/**
 * Where an imported Obsidian vault lands, and why nobody else sees it.
 *
 * Same model as Gmail (gmail/folder.ts): a vault is one person's notes, so
 * `Obsidian/<vault>` is restricted with a single `manage` grant to whoever
 * imported it, and the `Obsidian` root is restricted with no grants so no
 * one sees an empty folder they cannot open. Under ADR-010 the nearest
 * restricted ancestor decides, so each person sees their own vaults; the
 * manage grant lets them share one when they choose to. The vault's own
 * folders are rebuilt beneath it and inherit its audience.
 *
 * Two people may both have a vault called "Notes": the second gets
 * `Obsidian/Notes (2)`, found again on every re-import by its grant.
 */

import { and, eq } from "drizzle-orm";

import { category } from "@launchstack/store/schema";
import {
    FOLDER_SEPARATOR,
    MAX_FOLDER_DEPTH,
    MAX_FOLDER_NAME_CHARS,
    MAX_FOLDER_PATH_CHARS,
    splitFolderPath,
} from "~/lib/folders/path";
import { db } from "~/server/db";
import { folderGrants, folderSettings } from "~/server/db/schema";
import { createFolder } from "~/server/folders";
import type { OwnerRef } from "~/server/workspace/ownership";

export const OBSIDIAN_ROOT_FOLDER = "Obsidian";

/** Tries before giving up on a free `Obsidian/<vault> (n)` name. */
const MAX_NAME_ATTEMPTS = 50;

/** One folder-name segment that always passes the folder rules. */
function cleanSegment(raw: string, fallback: string): string {
    const segment = raw
        .replace(/\//g, "-")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, MAX_FOLDER_NAME_CHARS)
        .trim();
    return segment || fallback;
}

export function vaultFolderFor(vaultName: string, attempt = 1): string {
    const base = cleanSegment(vaultName, "Vault");
    const name =
        attempt === 1
            ? base
            : `${base.slice(0, MAX_FOLDER_NAME_CHARS - ` (${attempt})`.length)} (${attempt})`;
    return `${OBSIDIAN_ROOT_FOLDER}${FOLDER_SEPARATOR}${name}`;
}

/**
 * A note's folder inside the vault folder, clamped to the folder limits: too
 * deep and the extra levels fold into the deepest allowed one, too long and
 * trailing folders are dropped.
 */
export function noteFolderPath(vaultPath: string, noteFolder: string): string {
    const base = splitFolderPath(vaultPath);
    const inner = splitFolderPath(noteFolder).map(segment => cleanSegment(segment, "Folder"));
    const segments = [...base, ...inner].slice(0, MAX_FOLDER_DEPTH);
    while (
        segments.length > base.length &&
        segments.join(FOLDER_SEPARATOR).length > MAX_FOLDER_PATH_CHARS
    ) {
        segments.pop();
    }
    return segments.join(FOLDER_SEPARATOR);
}

async function categoryIdFor(companyId: bigint, path: string): Promise<bigint | null> {
    const [row] = await db
        .select({ id: category.id })
        .from(category)
        .where(and(eq(category.companyId, companyId), eq(category.name, path)))
        .limit(1);
    return row ? BigInt(row.id) : null;
}

async function grantsManageTo(categoryId: bigint, userPk: bigint): Promise<boolean> {
    const [row] = await db
        .select({ id: folderGrants.id })
        .from(folderGrants)
        .where(
            and(
                eq(folderGrants.categoryId, categoryId),
                eq(folderGrants.principalType, "user"),
                eq(folderGrants.principalId, userPk.toString()),
                eq(folderGrants.level, "manage")
            )
        )
        .limit(1);
    return Boolean(row);
}

async function restrictFolder(companyId: bigint, categoryId: bigint, updatedBy: string) {
    await db
        .insert(folderSettings)
        .values({ categoryId, companyId, visibility: "restricted", updatedBy })
        .onConflictDoNothing({ target: folderSettings.categoryId });
}

/** `Obsidian/<vault>` for this person: theirs from an earlier import, or a new one. */
export async function ensureVaultFolder(owner: OwnerRef, vaultName: string): Promise<string> {
    for (let attempt = 1; attempt <= MAX_NAME_ATTEMPTS; attempt++) {
        const path = vaultFolderFor(vaultName, attempt);
        const existing = await categoryIdFor(owner.companyId, path);
        if (existing != null) {
            if (await grantsManageTo(existing, owner.userPk)) return path;
            continue; // someone else's vault of the same name
        }

        await createFolder(owner.companyId, path);
        const [rootId, folderId] = await Promise.all([
            categoryIdFor(owner.companyId, OBSIDIAN_ROOT_FOLDER),
            categoryIdFor(owner.companyId, path),
        ]);
        if (rootId == null || folderId == null) {
            throw new Error(`Obsidian folder rows are missing after creation (${path})`);
        }
        await restrictFolder(owner.companyId, rootId, owner.authUserId);
        await restrictFolder(owner.companyId, folderId, owner.authUserId);
        await db
            .insert(folderGrants)
            .values({
                companyId: owner.companyId,
                categoryId: folderId,
                principalType: "user",
                principalId: owner.userPk.toString(),
                level: "manage",
                grantedBy: owner.authUserId,
            })
            .onConflictDoNothing({
                target: [
                    folderGrants.categoryId,
                    folderGrants.principalType,
                    folderGrants.principalId,
                ],
            });
        return path;
    }
    throw new Error(`No free folder name for the vault "${vaultName}"`);
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
