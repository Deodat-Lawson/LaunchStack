/**
 * Creating, renaming, moving and deleting folders as a person (ADR-014) —
 * every route that changes the folder tree goes through here, so none of them
 * can skip a rule:
 *
 * - create: a subfolder needs edit on its parent; the new folder gets
 *   ADR-014's defaults (top level → private to its creator). A name already
 *   taken by a folder the caller can't see gets a " (2)" suffix instead of
 *   silently doing nothing.
 * - rename / move: manage on the folder, edit on a new parent; a folder
 *   leaving the restricted folder it inherited from keeps that audience.
 * - delete: manage on the folder; restrictions inside the subtree are carried
 *   onto the documents it re-homes.
 *
 * Each lands in the audit log and the team activity feed, with the folder's
 * category id, so the feed checks visibility by id rather than by a path that
 * may since have been renamed or deleted.
 */

import { and, eq } from "drizzle-orm";

import { category } from "@launchstack/store/schema";
import { recordAuditEvent } from "~/lib/authz/audit";
import { scopeAllowsCategory } from "~/lib/authz/scope-types";
import { folderLeafName, folderParentPath, normalizeFolderPath } from "~/lib/folders/path";
import type { WorkspaceContext } from "~/lib/require-workspace-context";
import { db } from "~/server/db";
import {
    createFolder,
    deleteFolder,
    FolderError,
    listFolders,
    renameFolder,
    type DeleteFolderResult,
    type RenameFolderResult,
} from "~/server/folders";

import { recordActivity } from "./activity";
import type { Executor } from "./db-types";
import { canEditFolderPath, canManageFolderPath, folderAccess } from "./item-access";
import {
    applyFolderCreationDefaults,
    carryFolderRestrictionOnMove,
    carryRestrictionsBeforeFolderDelete,
} from "./ownership";

type Actor = Pick<
    WorkspaceContext,
    "companyId" | "userPk" | "authUserId" | "role" | "permissions" | "documentScope"
>;

const ownerOf = (ctx: Actor) => ({
    companyId: ctx.companyId,
    userPk: ctx.userPk,
    authUserId: ctx.authUserId,
});

async function folderIdOf(
    executor: Executor,
    companyId: bigint,
    path: string
): Promise<number | null> {
    const [row] = await executor
        .select({ id: category.id })
        .from(category)
        .where(and(eq(category.companyId, companyId), eq(category.name, path)))
        .limit(1);
    return row ? Number(row.id) : null;
}

/**
 * The name to create: the one asked for, or — when a folder the caller can't
 * see already holds it — the first free "Name (2)", "Name (3)", …
 */
async function availablePath(ctx: Actor, path: string): Promise<string> {
    const [folders, scope] = await Promise.all([listFolders(ctx.companyId), ctx.documentScope()]);
    const taken = new Set(folders.map(f => f.path));
    if (!taken.has(path) || scopeAllowsCategory(scope, path)) return path;
    for (let n = 2; n < 100; n++) {
        const candidate = `${path} (${n})`;
        if (!taken.has(candidate)) return candidate;
    }
    throw new FolderError("folder_exists", 409, "That name is already used. Try another.");
}

export async function createFolderAs(
    ctx: Actor,
    rawPath: string
): Promise<{ path: string; created: string[]; renamedTo: string | null }> {
    const asked = normalizeFolderPath(rawPath);
    const parent = folderParentPath(asked);
    if (parent && !(await canEditFolderPath(ctx, parent))) {
        throw new FolderError("forbidden", 403, "You do not have edit access to that folder.");
    }
    const path = await availablePath(ctx, asked);
    const owner = ownerOf(ctx);
    const result = await createFolder(ctx.companyId, path, async (tx, paths) => {
        await applyFolderCreationDefaults(tx, owner, paths);
        if (paths.length > 0) {
            await recordActivity(tx, {
                companyId: ctx.companyId,
                actorUserId: ctx.authUserId,
                verb: "created_folder",
                targetType: "folder",
                targetId: await folderIdOf(tx, ctx.companyId, path),
                targetLabel: folderLeafName(path),
                targetPath: path,
            });
        }
    });
    await recordAuditEvent(db, {
        companyId: ctx.companyId,
        actorUserId: ctx.authUserId,
        action: "folder.created",
        targetType: "folder",
        targetId: path,
        detail: { name: path },
    });
    return { ...result, renamedTo: path === asked ? null : path };
}

export async function renameFolderAs(
    ctx: Actor,
    rawFrom: string,
    rawTo: string
): Promise<RenameFolderResult & { access: "kept_audience" | "inherits_folder" | "unchanged" }> {
    const from = normalizeFolderPath(rawFrom);
    const to = normalizeFolderPath(rawTo);
    const scope = await ctx.documentScope();
    if (!scopeAllowsCategory(scope, from))
        throw new FolderError("folder_not_found", 404, "Folder not found.");
    if (!(await canManageFolderPath(ctx, from))) {
        throw new FolderError("forbidden", 403, "You do not manage this folder.");
    }
    const fromParent = folderParentPath(from);
    const toParent = folderParentPath(to);
    if (toParent !== fromParent && toParent && !(await canEditFolderPath(ctx, toParent))) {
        throw new FolderError(
            "forbidden",
            403,
            "You do not have edit access to the folder you are moving it into."
        );
    }
    // Whether teammates may read the old name afterwards: only if everyone
    // could see the folder under it.
    const fromWorkspace = (await folderAccess(ctx, from)).audience === "workspace";
    const owner = ownerOf(ctx);
    let access: "kept_audience" | "inherits_folder" | "unchanged" = "unchanged";
    let renamed: RenameFolderResult;
    try {
        renamed = await renameFolder(ctx.companyId, from, to, async (tx, f, t) => {
            // Moving never publishes: a folder leaving the restricted folder it
            // inherited from keeps that audience.
            access = await carryFolderRestrictionOnMove(tx, owner, f, t);
        });
    } catch (error) {
        // Don't confirm, by name, a folder the caller can't see.
        if (
            error instanceof FolderError &&
            error.code === "folder_exists" &&
            !scopeAllowsCategory(scope, to)
        ) {
            throw new FolderError("folder_exists", 409, "That name is already used. Try another.");
        }
        throw error;
    }
    await recordActivity(db, {
        companyId: ctx.companyId,
        actorUserId: ctx.authUserId,
        verb: toParent === fromParent ? "renamed" : "moved",
        targetType: "folder",
        targetId: await folderIdOf(db, ctx.companyId, renamed.to),
        targetLabel: folderLeafName(renamed.to),
        targetPath: renamed.to,
        detail: { from: renamed.from, to: renamed.to, access, fromWorkspace },
    });
    await recordAuditEvent(db, {
        companyId: ctx.companyId,
        actorUserId: ctx.authUserId,
        action: "folder.renamed",
        targetType: "folder",
        targetId: renamed.to,
        detail: { from: renamed.from, name: renamed.to },
    });
    return { ...renamed, access };
}

export async function deleteFolderAs(ctx: Actor, rawPath: string): Promise<DeleteFolderResult> {
    const path = normalizeFolderPath(rawPath);
    const scope = await ctx.documentScope();
    if (!scopeAllowsCategory(scope, path))
        throw new FolderError("folder_not_found", 404, "Folder not found.");
    if (!(await canManageFolderPath(ctx, path))) {
        throw new FolderError("forbidden", 403, "You do not manage this folder.");
    }
    // Whether teammates may read "Ada deleted Q3" afterwards: only if everyone
    // could see the folder (ADR-014 never leaks a private name).
    const wasWorkspace = (await folderAccess(ctx, path)).audience === "workspace";
    const folderId = await folderIdOf(db, ctx.companyId, path);
    const owner = ownerOf(ctx);
    const deleted = await deleteFolder(ctx.companyId, path, async (tx, p) => {
        // Deleting a private folder must not publish what was in it.
        await carryRestrictionsBeforeFolderDelete(tx, owner, p);
        await recordActivity(tx, {
            companyId: ctx.companyId,
            actorUserId: ctx.authUserId,
            verb: "deleted",
            targetType: "folder",
            targetId: folderId,
            targetLabel: folderLeafName(p),
            targetPath: p,
            detail: { wasWorkspace },
        });
    });
    await recordAuditEvent(db, {
        companyId: ctx.companyId,
        actorUserId: ctx.authUserId,
        action: "folder.deleted",
        targetType: "folder",
        targetId: path,
        detail: { name: path },
    });
    return deleted;
}
