/**
 * /api/folders — the workspace's folder tree.
 *
 * GET    any member with `documents.read`: every folder path the caller may
 *        see, with its direct source count, whether it is persisted, whether
 *        it (or an ancestor) is restricted, and the caller's `access` — its
 *        audience (workspace / shared / private), whether it inherits it,
 *        and whether they may edit or manage it.
 * POST   { path }            create a folder (and any missing ancestors).
 * PATCH  { path, newPath }   rename or move a folder and everything in it.
 * DELETE { path }            remove a folder and its subfolders; sources move up.
 *
 * Who may change the tree (ADR-014):
 * - create: anyone who can add sources (`documents.upload`). A new top-level
 *   folder is private to its creator; a subfolder needs edit access to its
 *   parent and inherits it. The creator always gets manage on what they made.
 * - rename / move / delete: manage access to the folder (a grant, or
 *   `folders.manage` while nothing above restricts it); a move also needs
 *   edit access to the new parent.
 * Each one lands in the audit log and the team activity feed. Folders are
 * paths (`~/lib/folders/path`), so a body carries the full path rather than an
 * id — a folder that exists only through the documents inside it has no row
 * to point at.
 */

import { z } from "zod";

import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";
import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { recordAuditEvent } from "~/lib/authz/audit";
import { db } from "~/server/db";
import { fail, handleRouteError, ok, readJson } from "~/server/api/responses";
import { createFolder, deleteFolder, listVisibleFolders, renameFolder } from "~/server/folders";
import { folderLeafName, folderParentPath, normalizeFolderPath } from "~/lib/folders/path";
import { recordActivity } from "~/server/workspace/activity";
import {
    accessSubject,
    canEditFolderPath,
    canManageFolderPath,
    folderAccess,
} from "~/server/workspace/item-access";
import {
    applyFolderCreationDefaults,
    carryRestrictionsBeforeFolderDelete,
} from "~/server/workspace/ownership";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PathBody = z.object({ path: z.string().min(1).max(512) });
const RenameBody = z.object({
    path: z.string().min(1).max(512),
    newPath: z.string().min(1).max(512),
});

async function parseBody<T>(request: Request, schema: z.ZodType<T>): Promise<T | null> {
    const parsed = schema.safeParse(await readJson(request));
    return parsed.success ? parsed.data : null;
}

export async function GET(request: Request) {
    return withRateLimit(request, RateLimitPresets.permissive, async () => {
        try {
            const ctx = await requireWorkspacePermission("documents.read");
            if (!ctx.success) return ctx.response;
            const [scope, subject] = await Promise.all([
                ctx.data.documentScope(),
                accessSubject(ctx.data),
            ]);
            return ok({
                folders: await listVisibleFolders(ctx.data.companyId, scope, subject),
            });
        } catch (error) {
            return handleRouteError("folders.list", error);
        }
    });
}

export async function POST(request: Request) {
    return withRateLimit(request, RateLimitPresets.standard, async () => {
        try {
            const ctx = await requireWorkspacePermission("documents.upload");
            if (!ctx.success) return ctx.response;

            const body = await parseBody(request, PathBody);
            if (!body) return fail("A folder path is required.", 400);

            const parent = folderParentPath(normalizeFolderPath(body.path));
            if (parent && !(await canEditFolderPath(ctx.data, parent))) {
                return fail("You do not have edit access to that folder.", 403);
            }
            const owner = {
                companyId: ctx.data.companyId,
                userPk: ctx.data.userPk,
                authUserId: ctx.data.authUserId,
            };
            const created = await createFolder(ctx.data.companyId, body.path, async (tx, paths) => {
                await applyFolderCreationDefaults(tx, owner, paths);
                if (paths.length > 0) {
                    await recordActivity(tx, {
                        companyId: ctx.data.companyId,
                        actorUserId: ctx.data.authUserId,
                        verb: "created_folder",
                        targetType: "folder",
                        targetLabel: folderLeafName(normalizeFolderPath(body.path)),
                        targetPath: normalizeFolderPath(body.path),
                    });
                }
            });
            await recordAuditEvent(db, {
                companyId: ctx.data.companyId,
                actorUserId: ctx.data.authUserId,
                action: "folder.created",
                targetType: "folder",
                targetId: body.path,
                detail: { name: body.path },
            });
            return ok(created, 201);
        } catch (error) {
            return handleRouteError("folders.create", error);
        }
    });
}

export async function PATCH(request: Request) {
    return withRateLimit(request, RateLimitPresets.standard, async () => {
        try {
            const ctx = await requireWorkspacePermission("documents.upload");
            if (!ctx.success) return ctx.response;

            const body = await parseBody(request, RenameBody);
            if (!body) return fail("Both the current and the new folder path are required.", 400);

            if (!(await canManageFolderPath(ctx.data, body.path))) {
                return fail("You do not manage this folder.", 403);
            }
            const fromParent = folderParentPath(normalizeFolderPath(body.path));
            const toParent = folderParentPath(normalizeFolderPath(body.newPath));
            if (
                toParent !== fromParent &&
                toParent &&
                !(await canEditFolderPath(ctx.data, toParent))
            ) {
                return fail(
                    "You do not have edit access to the folder you are moving it into.",
                    403
                );
            }

            const renamed = await renameFolder(ctx.data.companyId, body.path, body.newPath);
            await recordActivity(db, {
                companyId: ctx.data.companyId,
                actorUserId: ctx.data.authUserId,
                verb: toParent === fromParent ? "renamed" : "moved",
                targetType: "folder",
                targetLabel: folderLeafName(renamed.to),
                targetPath: renamed.to,
                detail: { from: renamed.from, to: renamed.to },
            });
            await recordAuditEvent(db, {
                companyId: ctx.data.companyId,
                actorUserId: ctx.data.authUserId,
                action: "folder.renamed",
                targetType: "folder",
                targetId: body.newPath,
                detail: { from: body.path, name: body.newPath },
            });
            return ok(renamed);
        } catch (error) {
            return handleRouteError("folders.rename", error);
        }
    });
}

export async function DELETE(request: Request) {
    return withRateLimit(request, RateLimitPresets.standard, async () => {
        try {
            const ctx = await requireWorkspacePermission("documents.upload");
            if (!ctx.success) return ctx.response;

            const body = await parseBody(request, PathBody);
            if (!body) return fail("A folder path is required.", 400);

            if (!(await canManageFolderPath(ctx.data, body.path))) {
                return fail("You do not manage this folder.", 403);
            }
            const owner = {
                companyId: ctx.data.companyId,
                userPk: ctx.data.userPk,
                authUserId: ctx.data.authUserId,
            };
            // Whether teammates may read "Ada deleted Q3" afterwards: only if
            // everyone could see the folder (ADR-014 never leaks a private name).
            const wasWorkspace = (await folderAccess(ctx.data, body.path)).audience === "workspace";
            const deleted = await deleteFolder(ctx.data.companyId, body.path, async (tx, path) => {
                // Deleting a private folder must not publish what was in it.
                await carryRestrictionsBeforeFolderDelete(tx, owner, path);
                await recordActivity(tx, {
                    companyId: ctx.data.companyId,
                    actorUserId: ctx.data.authUserId,
                    verb: "deleted",
                    targetType: "folder",
                    targetLabel: folderLeafName(path),
                    targetPath: path,
                    detail: { wasWorkspace },
                });
            });
            await recordAuditEvent(db, {
                companyId: ctx.data.companyId,
                actorUserId: ctx.data.authUserId,
                action: "folder.deleted",
                targetType: "folder",
                targetId: body.path,
                detail: { name: body.path },
            });
            return ok(deleted);
        } catch (error) {
            return handleRouteError("folders.delete", error);
        }
    });
}
