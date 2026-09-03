/**
 * Folder mutations over the path model (see `~/lib/folders/path`).
 *
 * A folder exists when a `category` row carries its path or a document lives
 * in it. Renaming, moving and deleting are prefix rewrites over both tables
 * in one transaction, so a folder and everything beneath it move together and
 * a deleted folder cannot come back from the documents that were inside it —
 * they are re-homed first.
 */

import { and, eq, inArray, like, or, sql } from "drizzle-orm";
import { category, document } from "@launchstack/store/schema";

import { db } from "~/server/db";
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

export async function listFolders(companyId: bigint): Promise<FolderRecord[]> {
    const [rows, counts] = await Promise.all([
        db.select({ name: category.name }).from(category).where(eq(category.companyId, companyId)),
        db
            .select({ path: document.category, count: sql<number>`count(*)::int` })
            .from(document)
            .where(eq(document.companyId, companyId))
            .groupBy(document.category),
    ]);

    const persisted = new Set(rows.map(row => normalizeFolderPath(row.name)));
    const documentCounts = new Map<string, number>();
    for (const row of counts) {
        const path = normalizeFolderPath(row.path);
        documentCounts.set(path, (documentCounts.get(path) ?? 0) + Number(row.count));
    }

    return expandFolderPaths([...persisted, ...documentCounts.keys()]).map(path => ({
        path,
        documentCount: documentCounts.get(path) ?? 0,
        persisted: persisted.has(path),
    }));
}

async function existingPaths(companyId: bigint): Promise<Set<string>> {
    return new Set((await listFolders(companyId)).map(folder => folder.path));
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

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
    rawPath: string
): Promise<{ path: string; created: string[] }> {
    const path = normalizeFolderPath(rawPath);
    assertAcceptablePath(path);
    const created = await db.transaction(tx => ensureFolderRows(tx, companyId, path));
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

/** Remove a folder and its subfolders; the sources inside move up one level. */
export async function deleteFolder(
    companyId: bigint,
    rawPath: string
): Promise<DeleteFolderResult> {
    const path = normalizeFolderPath(rawPath);
    if (isUnfiledFolder(path)) {
        throw new FolderError("unfiled_reserved", 400, `"${UNFILED_FOLDER}" can't be deleted.`);
    }
    const existing = await existingPaths(companyId);
    if (!existing.has(path)) throw new FolderError("folder_not_found", 404, "Folder not found.");

    const destination = folderParentPath(path) ?? UNFILED_FOLDER;

    return db.transaction(async tx => {
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
