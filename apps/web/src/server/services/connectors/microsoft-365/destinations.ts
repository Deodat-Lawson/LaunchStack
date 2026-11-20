/**
 * Where a synced OneDrive or SharePoint file lands. The rules are Google
 * Drive's (ADR-014; see ../google-drive/destinations, whose naming and
 * path helpers this reuses):
 *
 * - A picked **folder** becomes a LaunchStack folder of the same name inside
 *   the folder chosen in Add source, with its subfolders rebuilt beneath it.
 *   It is created the way a person creating it by hand would: with a manage
 *   grant for whoever picked it on every folder the sync adds, and as open
 *   as its parent. The folder's id is remembered on the picked row, so a
 *   rename or move in LaunchStack is followed rather than undone, and a name
 *   already in use gets " (2)" instead of mixing two imports. A folder
 *   picked again after "Stop syncing" (which forgets the row) finds its old
 *   home through the documents it already brought in.
 * - A picked **file** lands in the folder chosen in Add source, as an upload
 *   there would. A pick without a destination goes to the workspace's
 *   "Microsoft 365" folder as a workspace import.
 *
 * Folder creation is serialized for the whole run: the sync stores four
 * files at once, and two of them reaching the same new subfolder must not
 * both insert it.
 */

import { and, asc, eq, sql } from "drizzle-orm";

import { category, document } from "@launchstack/store/schema";
import { FOLDER_SEPARATOR, normalizeFolderPath, splitFolderPath } from "~/lib/folders/path";
import { db } from "~/server/db";
import { microsoft365PickedItem } from "~/server/db/schema/connectors";
import { createFolder, listFolders } from "~/server/folders";
import { applyFolderCreationDefaults, type OwnerRef } from "~/server/workspace/ownership";

import { freeFolderPath, placementPath } from "../google-drive/destinations";
import { MICROSOFT_365_CATEGORY, MICROSOFT_365_CONNECTOR } from "./sink";

export { missingToMark, ownerForPick } from "../google-drive/destinations";

/** What the sync needs to know about a picked row to place its files. */
export interface PickedRoot {
    readonly id: bigint;
    /** `${driveId}:${itemId}`, the id the connector reports a pick by. */
    readonly sourceId: string;
    readonly kind: string;
    readonly name: string;
    readonly folderCategoryId: number | null;
    /** The folder chosen in Add source. */
    readonly destination: string | null;
    /** The person who picked it, or whoever connected the account when they have left. */
    readonly owner: OwnerRef | null;
}

export interface Microsoft365Placement {
    readonly category: string;
    /** Who the new document belongs to (ADR-014 defaults); null = workspace import. */
    readonly owner: OwnerRef | null;
}

export interface Microsoft365Destinations {
    placeFor(item: { readonly metadata: Record<string, unknown> }): Promise<Microsoft365Placement>;
}

export function createMicrosoft365Destinations(params: {
    readonly companyId: bigint;
    /** Whose documents to look through when re-adopting a re-picked folder. */
    readonly connectionId: number;
    readonly roots: readonly PickedRoot[];
}): Microsoft365Destinations {
    const { companyId, connectionId } = params;
    const rootsBySourceId = new Map(params.roots.map(root => [root.sourceId, root]));
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
            .update(microsoft365PickedItem)
            .set({ folderCategoryId: Number(row.id) })
            .where(eq(microsoft365PickedItem.id, root.id));
        return true;
    }

    /**
     * The folder an earlier pick of this folder filled: from the documents
     * it brought in, each knowing its subfolders, work back to the top. Only
     * a match that reproduces the document's actual folder counts.
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
                    sql`${document.ocrMetadata} ->> 'connector' = ${MICROSOFT_365_CONNECTOR}`,
                    sql`${document.ocrMetadata} ->> 'connectionId' = ${String(connectionId)}`,
                    sql`${document.ocrMetadata} ->> 'pickedRootId' = ${root.sourceId}`
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
        const path = freeFolderPath(root.destination, root.name, taken);
        await createFolder(companyId, path, async (tx, created) => {
            if (root.owner) await applyFolderCreationDefaults(tx, root.owner, created);
        });
        await remember(root, path);
        return path;
    }

    function rootPathFor(root: PickedRoot): Promise<string> {
        let pending = rootPaths.get(root.sourceId);
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
            rootPaths.set(root.sourceId, pending);
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
            const rootId = item.metadata.pickedRoot;
            const root = typeof rootId === "string" ? rootsBySourceId.get(rootId) : undefined;
            if (!root || root.kind !== "folder") {
                // Picked into a folder: the same as uploading there.
                return root?.destination
                    ? { category: normalizeFolderPath(root.destination), owner: root.owner }
                    : { category: MICROSOFT_365_CATEGORY, owner: null };
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
