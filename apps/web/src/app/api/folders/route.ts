/**
 * /api/folders — the workspace's folder tree.
 *
 * GET    any member with `documents.read`: every folder path the caller may
 *        see, with its direct source count, whether it is persisted, and
 *        whether it (or an ancestor) is restricted.
 * POST   { path }            create a folder (and any missing ancestors).
 * PATCH  { path, newPath }   rename or move a folder and everything in it.
 * DELETE { path }            remove a folder and its subfolders; sources move up.
 *
 * Mutations need `folders.manage`, like every other write to the library's
 * structure, and each one lands in the audit log. Folders are paths (`~/lib/folders/path`), so a body carries the
 * full path rather than an id — a folder that exists only through the
 * documents inside it has no row to point at.
 */

import { z } from "zod";

import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";
import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { recordAuditEvent } from "~/lib/authz/audit";
import { db } from "~/server/db";
import { fail, handleRouteError, ok, readJson } from "~/server/api/responses";
import { createFolder, deleteFolder, listVisibleFolders, renameFolder } from "~/server/folders";

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
            const scope = await ctx.data.documentScope();
            return ok({ folders: await listVisibleFolders(ctx.data.companyId, scope) });
        } catch (error) {
            return handleRouteError("folders.list", error);
        }
    });
}

export async function POST(request: Request) {
    return withRateLimit(request, RateLimitPresets.standard, async () => {
        try {
            const ctx = await requireWorkspacePermission("folders.manage");
            if (!ctx.success) return ctx.response;

            const body = await parseBody(request, PathBody);
            if (!body) return fail("A folder path is required.", 400);

            const created = await createFolder(ctx.data.companyId, body.path);
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
            const ctx = await requireWorkspacePermission("folders.manage");
            if (!ctx.success) return ctx.response;

            const body = await parseBody(request, RenameBody);
            if (!body) return fail("Both the current and the new folder path are required.", 400);

            const renamed = await renameFolder(ctx.data.companyId, body.path, body.newPath);
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
            const ctx = await requireWorkspacePermission("folders.manage");
            if (!ctx.success) return ctx.response;

            const body = await parseBody(request, PathBody);
            if (!body) return fail("A folder path is required.", 400);

            const deleted = await deleteFolder(ctx.data.companyId, body.path);
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
