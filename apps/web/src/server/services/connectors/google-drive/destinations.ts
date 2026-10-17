/**
 * Where a synced Drive file lands (Q2 of the shared-folder import, ADR-014).
 *
 * - A picked **folder** becomes a LaunchStack folder of the same name, with
 *   its subfolders rebuilt beneath it. It is created the way a person creating
 *   it by hand would: a new top-level folder, private to whoever picked it,
 *   with a manage grant for them on every folder the sync adds. The folder's
 *   id is remembered on the picked row, so a rename or move in LaunchStack is
 *   followed rather than undone, and a name someone else already uses gets
 *   " (2)" instead of mixing two imports. A folder picked again after "Stop
 *   syncing" (which forgets the row) finds its old home through the
 *   documents it already brought in.
 * - A picked **file** keeps today's behaviour: the workspace's "Google Drive"
 *   folder.
 *
 * Folder creation is serialized for the whole run: the sink stores four files
 * at once, and two of them reaching the same new subfolder must not both
 * insert it.
 */

import { and, asc, eq, sql } from "drizzle-orm";

import { category, document } from "@launchstack/store/schema";
import {
    FOLDER_SEPARATOR,
    MAX_FOLDER_DEPTH,
    MAX_FOLDER_NAME_CHARS,
    MAX_FOLDER_PATH_CHARS,
    UNFILED_FOLDER,
    normalizeFolderPath,
    splitFolderPath,
} from "~/lib/folders/path";
import { db } from "~/server/db";
import { googleDrivePickedItem } from "~/server/db/schema/connectors";
import { createFolder, listFolders } from "~/server/folders";
import { applyFolderCreationDefaults, type OwnerRef } from "~/server/workspace/ownership";

import { GOOGLE_DRIVE_CATEGORY } from "./sink";

/** Used when a Drive folder's name cleans down to nothing. */
const UNNAMED_FOLDER = "Drive folder";

/** What the sync needs to know about a picked row to place its files. */
export interface PickedRoot {
    readonly id: bigint;
    readonly fileId: string;
    readonly kind: string;
    readonly name: string;
    readonly folderCategoryId: number | null;
    /** The person who picked it; null when they have since left. */
    readonly owner: OwnerRef | null;
}

/**
 * Who owns what a pick brings in: the person who picked it while they are
 * still an active member, otherwise whoever connected Drive — so a folder the
 * sync creates is never left without an owner, and so open to the workspace.
 */
export function ownerForPick(
    addedByUserPk: number | null,
    activePickers: ReadonlyMap<number, OwnerRef>,
    connectedBy: OwnerRef
): OwnerRef {
    return (addedByUserPk == null ? undefined : activePickers.get(addedByUserPk)) ?? connectedBy;
}

export interface DrivePlacement {
    readonly category: string;
    /** Who the new document belongs to (ADR-014 defaults); null = workspace import. */
    readonly owner: OwnerRef | null;
}

/**
 * One Drive folder name as a LaunchStack folder name: no path separator,
 * collapsed whitespace, within the length limit. `Unfiled` is reserved.
 */
export function folderSegmentFor(name: string): string {
    const cleaned = name
        .replaceAll(FOLDER_SEPARATOR, "-")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, MAX_FOLDER_NAME_CHARS)
        .trim();
    if (!cleaned) return UNNAMED_FOLDER;
    return cleaned === UNFILED_FOLDER ? `${UNFILED_FOLDER} (Drive)` : cleaned;
}

/**
 * The folder for a file `subfolders` deep beneath `rootPath`. LaunchStack
 * folders nest at most MAX_FOLDER_DEPTH deep within MAX_FOLDER_PATH_CHARS;
 * a deeper Drive tree is cut at the last folder that fits, and its files
 * land there, so nothing is dropped.
 */
export function placementPath(rootPath: string, subfolders: readonly string[]): string {
    let path = normalizeFolderPath(rootPath);
    let depth = path.split(FOLDER_SEPARATOR).length;
    for (const name of subfolders) {
        const segment = folderSegmentFor(name);
        const next = `${path}${FOLDER_SEPARATOR}${segment}`;
        if (depth + 1 > MAX_FOLDER_DEPTH || next.length > MAX_FOLDER_PATH_CHARS) break;
        path = next;
        depth += 1;
    }
    return path;
}

/** The first of `Name`, `Name (2)`, `Name (3)`, … that no folder uses yet. */
export function freeTopLevelPath(name: string, taken: ReadonlySet<string>): string {
    const base = folderSegmentFor(name);
    if (!taken.has(base)) return base;
    for (let n = 2; n < 1000; n++) {
        const suffix = ` (${n})`;
        const candidate = `${base.slice(0, MAX_FOLDER_NAME_CHARS - suffix.length).trim()}${suffix}`;
        if (!taken.has(candidate)) return candidate;
    }
    throw new Error(`No free folder name for "${base}"`);
}

export interface DriveDestinations {
    placeFor(item: { readonly metadata: Record<string, unknown> }): Promise<DrivePlacement>;
}

export function createDriveDestinations(params: {
    readonly companyId: bigint;
    /** Whose documents to look through when re-adopting a re-picked folder. */
    readonly connectionId: number;
    readonly roots: readonly PickedRoot[];
}): DriveDestinations {
    const { companyId, connectionId } = params;
    const rootsByFileId = new Map(params.roots.map(root => [root.fileId, root]));
    const rootPaths = new Map<string, Promise<string>>();
    const ensured = new Map<string, Promise<void>>();
    let queue: Promise<unknown> = Promise.resolve();

    /** Runs folder writes one at a time, in the order they were asked for. */
    function serialized<T>(task: () => Promise<T>): Promise<T> {
        const run = queue.then(task, task);
        queue = run.catch(() => undefined);
        return run;
    }

    async function currentPathOf(categoryId: number): Promise<string | null> {
        const [row] = await db
            .select({ name: category.name })
            .from(category)
            .where(and(eq(category.id, categoryId), eq(category.companyId, companyId)))
            .limit(1);
        return row ? normalizeFolderPath(row.name) : null;
    }

    /** Remember `path` as this pick's folder, by id, so renames are followed. */
    async function remember(root: PickedRoot, path: string): Promise<boolean> {
        const [row] = await db
            .select({ id: category.id })
            .from(category)
            .where(and(eq(category.companyId, companyId), eq(category.name, path)))
            .limit(1);
        if (!row) return false;
        await db
            .update(googleDrivePickedItem)
            .set({ folderCategoryId: Number(row.id) })
            .where(eq(googleDrivePickedItem.id, root.id));
        return true;
    }

    /**
     * The folder an earlier pick of this Drive folder filled: from the
     * documents it brought in, each knowing its subfolders, work back to the
     * top. Only a match that reproduces the document's actual folder counts.
     */
    async function previousFolder(root: PickedRoot): Promise<string | null> {
        const depth = sql`jsonb_array_length(coalesce(${document.ocrMetadata} -> 'folderPath', '[]'::jsonb))`;
        const rows = await db
            .select({
                category: document.category,
                folderPath: sql<unknown>`${document.ocrMetadata} -> 'folderPath'`,
            })
            .from(document)
            .where(
                and(
                    eq(document.companyId, companyId),
                    sql`${document.ocrMetadata} ->> 'connector' = 'google-drive'`,
                    sql`${document.ocrMetadata} ->> 'connectionId' = ${String(connectionId)}`,
                    sql`${document.ocrMetadata} ->> 'pickedRootId' = ${root.fileId}`
                )
            )
            .orderBy(asc(depth))
            .limit(20);
        for (const row of rows) {
            const subfolders = Array.isArray(row.folderPath)
                ? row.folderPath.filter((s): s is string => typeof s === "string")
                : [];
            const segments = splitFolderPath(row.category);
            if (segments.length <= subfolders.length) continue;
            const candidate = segments
                .slice(0, segments.length - subfolders.length)
                .join(FOLDER_SEPARATOR);
            if (placementPath(candidate, subfolders) !== normalizeFolderPath(row.category)) {
                continue;
            }
            if (await remember(root, candidate)) return candidate;
        }
        return null;
    }

    async function createRootFolder(root: PickedRoot): Promise<string> {
        const taken = new Set((await listFolders(companyId)).map(folder => folder.path));
        const path = freeTopLevelPath(root.name, taken);
        await createFolder(companyId, path, async (tx, created) => {
            if (root.owner) await applyFolderCreationDefaults(tx, root.owner, created);
        });
        await remember(root, path);
        return path;
    }

    function rootPathFor(root: PickedRoot): Promise<string> {
        let pending = rootPaths.get(root.fileId);
        if (!pending) {
            pending = serialized(async () => {
                // The remembered folder wins, wherever it has been moved to;
                // a deleted one is made again.
                const remembered =
                    root.folderCategoryId == null
                        ? null
                        : await currentPathOf(root.folderCategoryId);
                return remembered ?? (await previousFolder(root)) ?? (await createRootFolder(root));
            });
            rootPaths.set(root.fileId, pending);
        }
        return pending;
    }

    function ensureFolder(path: string, owner: OwnerRef | null): Promise<void> {
        let pending = ensured.get(path);
        if (!pending) {
            pending = serialized(async () => {
                await createFolder(companyId, path, async (tx, created) => {
                    if (owner) await applyFolderCreationDefaults(tx, owner, created);
                });
            });
            ensured.set(path, pending);
        }
        return pending;
    }

    return {
        async placeFor(item) {
            const rootId = item.metadata.pickedRootId;
            const root = typeof rootId === "string" ? rootsByFileId.get(rootId) : undefined;
            if (!root || root.kind !== "folder") {
                return { category: GOOGLE_DRIVE_CATEGORY, owner: null };
            }
            const rootPath = await rootPathFor(root);
            const subfolders = Array.isArray(item.metadata.folderPath)
                ? item.metadata.folderPath.filter(
                      (segment): segment is string => typeof segment === "string"
                  )
                : [];
            const path = placementPath(rootPath, subfolders);
            if (path !== rootPath) await ensureFolder(path, root.owner);
            return { category: path, owner: root.owner };
        },
    };
}
