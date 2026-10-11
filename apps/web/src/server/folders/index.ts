/**
 * Folder mutations over the path model (see `~/lib/folders/path`).
 *
 * A folder exists when a `category` row carries its path or a document lives
 * in it. Renaming, moving and deleting are prefix rewrites over both tables
 * in one transaction, so a folder and everything beneath it move together and
 * a deleted folder cannot come back from the documents that were inside it —
 * they are re-homed first.
 */

import { folderSettings } from "~/server/db/schema";
import { scopeAllowsCategory, type DocumentScope } from "~/lib/authz/scope-types";
import { and, eq, inArray, like, or, sql } from "drizzle-orm";
import { category, document } from "@launchstack/store/schema";

import { db } from "~/server/db";
import type { AccessSubject } from "~/server/workspace/item-access";
import {
    accessViewOf,
    classifyFolders,
    loadFolderAccessFacts,
    type AccessView,
} from "~/server/workspace/source-access";
import {
    FOLDER_SEPARATOR,
    UNFILED_FOLDER,
    expandFolderPaths,
    folderAncestors,
    folderParentPath,
    isFolderOrDescendant,
    isUnfiledFolder,
    normalizeFolderPath,
    validateFolderPath,
} from "~/lib/folders/path";

/** An expected outcome with its own HTTP status — the route reports it as-is. */
export class FolderError extends Error {
    override readonly name = "FolderError";
    readonly code: string;
    readonly status: number;

    constructor(code: string, status: number, message: string) {
        super(message);
        this.code = code;
        this.status = status;
    }
}

export interface FolderRecord {
    path: string;
    /** Sources directly in this folder. */
    documentCount: number;
    /** Backed by a `category` row, so it survives being emptied. */
    persisted: boolean;
    /** The `category` row behind a persisted folder; null while only implied. */
    categoryId: number | null;
    /** The folder, or an ancestor, is restricted to the people granted access. */
    restricted: boolean;
}

/** A folder as one person's rail sees it: who else can, and what they may do with it. */
export interface VisibleFolderRecord extends FolderRecord {
    access: AccessView;
}

/** Escape a literal for a LIKE pattern (Postgres escapes with a backslash by default). */
export function escapeLikeLiteral(value: string): string {
    return value.replace(/[\\%_]/g, match => `\\${match}`);
}

/** The LIKE pattern matching everything strictly beneath a folder. */
export function descendantPattern(path: string): string {
    return `${escapeLikeLiteral(path)}${FOLDER_SEPARATOR}%`;
}

function documentSubtree(companyId: bigint, path: string) {
    return and(
        eq(document.companyId, companyId),
        or(eq(document.category, path), like(document.category, descendantPattern(path)))
    );
}

function categorySubtree(companyId: bigint, path: string) {
    return and(
        eq(category.companyId, companyId),
        or(eq(category.name, path), like(category.name, descendantPattern(path)))
    );
}

/** `to || substr(column, len(from) + 1)` — the prefix rewrite, in SQL. */
function rewritePrefix(
    column: typeof document.category | typeof category.name,
    from: string,
    to: string
) {
    return sql<string>`${to} || substr(${column}, ${from.length + 1})`;
}

/** The rows behind the tree: persisted folders, document counts, restricted settings. */
async function loadFolderTable(companyId: bigint) {
    const [rows, counts, restrictedRows] = await Promise.all([
        db
            .select({ id: category.id, name: category.name })
            .from(category)
            .where(eq(category.companyId, companyId)),
        db
            .select({ path: document.category, count: sql<number>`count(*)::int` })
            .from(document)
            .where(eq(document.companyId, companyId))
            .groupBy(document.category),
        db
            .select({ categoryId: folderSettings.categoryId })
            .from(folderSettings)
            .where(
                and(
                    eq(folderSettings.companyId, companyId),
                    eq(folderSettings.visibility, "restricted")
                )
            ),
    ]);

    const persisted = new Map<string, number>();
    for (const row of rows) persisted.set(normalizeFolderPath(row.name), Number(row.id));
    const documentCounts = new Map<string, number>();
    for (const row of counts) {
        const path = normalizeFolderPath(row.path);
        documentCounts.set(path, (documentCounts.get(path) ?? 0) + Number(row.count));
    }
    const restrictedIds = new Set(restrictedRows.map(row => Number(row.categoryId)));
    // The id the access rules read for a path: the first row, as
    // `loadFolderLineage` takes it (the table has no unique (company, name)).
    const idByPath = new Map<string, number>();
    for (const row of [...rows].sort((a, b) => Number(a.id) - Number(b.id))) {
        const path = normalizeFolderPath(row.name);
        if (!idByPath.has(path)) idByPath.set(path, Number(row.id));
    }
    return { persisted, documentCounts, restrictedIds, idByPath };
}

function toRecords(table: Awaited<ReturnType<typeof loadFolderTable>>): FolderRecord[] {
    const { persisted, documentCounts, restrictedIds } = table;
    const restrictedPaths = [...persisted.entries()]
        .filter(([, id]) => restrictedIds.has(id))
        .map(([path]) => path);

    return expandFolderPaths([...persisted.keys(), ...documentCounts.keys()]).map(path => ({
        path,
        documentCount: documentCounts.get(path) ?? 0,
        persisted: persisted.has(path),
        categoryId: persisted.get(path) ?? null,
        // A restriction covers the folder and everything beneath it.
        restricted: restrictedPaths.some(restricted => isFolderOrDescendant(path, restricted)),
    }));
}

export async function listFolders(companyId: bigint): Promise<FolderRecord[]> {
    return toRecords(await loadFolderTable(companyId));
}

/**
 * `listFolders`, minus every folder the caller may not see. With `subject`,
 * each folder also carries the caller's `access` (ADR-014): its audience
 * (workspace, shared, private), whether it sets that itself or inherits it,
 * and whether they may edit or manage it — worked out in memory from one
 * read of the workspace's grants, not a lookup per folder.
 */
export async function listVisibleFolders(
    companyId: bigint,
    scope: DocumentScope
): Promise<FolderRecord[]>;
export async function listVisibleFolders(
    companyId: bigint,
    scope: DocumentScope,
    subject: AccessSubject
): Promise<VisibleFolderRecord[]>;
export async function listVisibleFolders(
    companyId: bigint,
    scope: DocumentScope,
    subject?: AccessSubject
): Promise<FolderRecord[] | VisibleFolderRecord[]> {
    const table = await loadFolderTable(companyId);
    const all = toRecords(table);
    const visible =
        scope.kind === "everything"
            ? all
            : all.filter(folder => scopeAllowsCategory(scope, folder.path));
    if (!subject) return visible;
    const facts = await loadFolderAccessFacts(companyId, {
        idByPath: table.idByPath,
        restrictedIds: table.restrictedIds,
    });
    const access = classifyFolders(
        visible.map(folder => folder.path),
        facts,
        subject
    );
    return visible.map(folder => ({
        ...folder,
        access: accessViewOf(access.get(folder.path)!),
    }));
}

async function existingPaths(companyId: bigint): Promise<Set<string>> {
    return new Set((await listFolders(companyId)).map(folder => folder.path));
}

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Insert a `category` row for the path and each ancestor that lacks one. */
async function ensureFolderRows(tx: Tx, companyId: bigint, path: string): Promise<string[]> {
    const wanted = [...folderAncestors(path), path];
    const present = new Set(
        (
            await tx
                .select({ name: category.name })
                .from(category)
                .where(and(eq(category.companyId, companyId), inArray(category.name, wanted)))
        ).map(row => normalizeFolderPath(row.name))
    );
    const missing = wanted.filter(candidate => !present.has(candidate));
    if (missing.length > 0) {
        await tx.insert(category).values(missing.map(name => ({ name, companyId })));
    }
    return missing;
}

function assertAcceptablePath(path: string): void {
    const problem = validateFolderPath(path);
    if (problem) throw new FolderError("invalid_folder", 400, problem);
}

export async function createFolder(
    companyId: bigint,
    rawPath: string,
    /** Runs in the same transaction with the paths that were new (ADR-014 defaults). */
    onCreated?: (tx: Tx, created: string[]) => Promise<void>
): Promise<{ path: string; created: string[] }> {
    const path = normalizeFolderPath(rawPath);
    assertAcceptablePath(path);
    const created = await db.transaction(async tx => {
        const inserted = await ensureFolderRows(tx, companyId, path);
        if (onCreated) await onCreated(tx, inserted);
        return inserted;
    });
    return { path, created };
}

export interface RenameFolderResult {
    from: string;
    to: string;
    movedDocuments: number;
    renamedFolders: number;
}

/**
 * Rename or move a folder — the same operation: the path changes. Everything
 * beneath it follows. Refuses to move a folder into itself or onto a folder
 * that already exists, so nothing is ever silently merged.
 */
export async function renameFolder(
    companyId: bigint,
    rawFrom: string,
    rawTo: string
): Promise<RenameFolderResult> {
    const from = normalizeFolderPath(rawFrom);
    const to = normalizeFolderPath(rawTo);

    if (isUnfiledFolder(from)) {
        throw new FolderError(
            "unfiled_reserved",
            400,
            `"${UNFILED_FOLDER}" can't be renamed or moved.`
        );
    }
    assertAcceptablePath(to);
    if (from === to) return { from, to, movedDocuments: 0, renamedFolders: 0 };
    if (isFolderOrDescendant(to, from)) {
        throw new FolderError("folder_cycle", 400, "A folder can't be moved into itself.");
    }

    const existing = await existingPaths(companyId);
    if (!existing.has(from)) throw new FolderError("folder_not_found", 404, "Folder not found.");
    if (existing.has(to)) {
        throw new FolderError(
            "folder_exists",
            409,
            `A folder named "${to.split(FOLDER_SEPARATOR).pop()}" already exists there.`
        );
    }

    return db.transaction(async tx => {
        const parent = folderParentPath(to);
        if (parent) await ensureFolderRows(tx, companyId, parent);

        const renamed = await tx
            .update(category)
            .set({ name: rewritePrefix(category.name, from, to) })
            .where(categorySubtree(companyId, from))
            .returning({ id: category.id });

        // A folder that only existed through its documents gets a row now, so
        // the rename is visible even if those documents move out later.
        if (renamed.length === 0) await ensureFolderRows(tx, companyId, to);

        const moved = await tx
            .update(document)
            .set({ category: rewritePrefix(document.category, from, to) })
            .where(documentSubtree(companyId, from))
            .returning({ id: document.id });

        return { from, to, movedDocuments: moved.length, renamedFolders: renamed.length };
    });
}

export interface DeleteFolderResult {
    path: string;
    /** Where the folder's sources went: its parent, or Unfiled at the top level. */
    destination: string;
    movedDocuments: number;
    deletedFolders: number;
}

/**
 * Remove a folder and its subfolders; the sources inside move up one level.
 * `beforeMove` runs first in the same transaction — ADR-014 uses it to carry a
 * deleted folder's restriction onto the documents it re-homes.
 */
export async function deleteFolder(
    companyId: bigint,
    rawPath: string,
    beforeMove?: (tx: Tx, path: string) => Promise<void>
): Promise<DeleteFolderResult> {
    const path = normalizeFolderPath(rawPath);
    if (isUnfiledFolder(path)) {
        throw new FolderError("unfiled_reserved", 400, `"${UNFILED_FOLDER}" can't be deleted.`);
    }
    const existing = await existingPaths(companyId);
    if (!existing.has(path)) throw new FolderError("folder_not_found", 404, "Folder not found.");

    const destination = folderParentPath(path) ?? UNFILED_FOLDER;

    return db.transaction(async tx => {
        if (beforeMove) await beforeMove(tx, path);
        const moved = await tx
            .update(document)
            .set({ category: destination })
            .where(documentSubtree(companyId, path))
            .returning({ id: document.id });
        const deleted = await tx
            .delete(category)
            .where(categorySubtree(companyId, path))
            .returning({ id: category.id });
        return { path, destination, movedDocuments: moved.length, deletedFolders: deleted.length };
    });
}
