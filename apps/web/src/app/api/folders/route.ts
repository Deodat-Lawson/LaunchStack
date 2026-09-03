/**
 * /api/folders — the workspace's folder tree.
 *
 * GET    any verified member: every folder path with its direct source count.
 * POST   { path }            create a folder (and any missing ancestors).
 * PATCH  { path, newPath }   rename or move a folder and everything in it.
 * DELETE { path }            remove a folder and its subfolders; sources move up.
 *
 * Mutations are management-only, like every other write to the library's
 * structure. Folders are paths (`~/lib/folders/path`), so a body carries the
 * full path rather than an id — a folder that exists only through the
 * documents inside it has no row to point at.
 */

import { z } from "zod";

import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";
import {
    forbiddenForRole,
    isManagementRole,
    requireWorkspaceContext,
} from "~/lib/require-workspace-context";
import { fail, handleRouteError, ok, readJson } from "~/server/api/responses";
import { createFolder, deleteFolder, listFolders, renameFolder } from "~/server/folders";

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
            const ctx = await requireWorkspaceContext();
            if (!ctx.success) return ctx.response;
            return ok({ folders: await listFolders(ctx.data.companyId) });
        } catch (error) {
            return handleRouteError("folders.list", error);
        }
    });
}

export async function POST(request: Request) {
    return withRateLimit(request, RateLimitPresets.standard, async () => {
        try {
            const ctx = await requireWorkspaceContext();
            if (!ctx.success) return ctx.response;
            if (!isManagementRole(ctx.data.role)) return forbiddenForRole();

            const body = await parseBody(request, PathBody);
            if (!body) return fail("A folder path is required.", 400);

            return ok(await createFolder(ctx.data.companyId, body.path), 201);
        } catch (error) {
            return handleRouteError("folders.create", error);
        }
    });
}

export async function PATCH(request: Request) {
    return withRateLimit(request, RateLimitPresets.standard, async () => {
        try {
            const ctx = await requireWorkspaceContext();
            if (!ctx.success) return ctx.response;
            if (!isManagementRole(ctx.data.role)) return forbiddenForRole();

            const body = await parseBody(request, RenameBody);
            if (!body) return fail("Both the current and the new folder path are required.", 400);

            return ok(await renameFolder(ctx.data.companyId, body.path, body.newPath));
        } catch (error) {
            return handleRouteError("folders.rename", error);
        }
    });
}

export async function DELETE(request: Request) {
    return withRateLimit(request, RateLimitPresets.standard, async () => {
        try {
            const ctx = await requireWorkspaceContext();
            if (!ctx.success) return ctx.response;
            if (!isManagementRole(ctx.data.role)) return forbiddenForRole();

            const body = await parseBody(request, PathBody);
            if (!body) return fail("A folder path is required.", 400);

            return ok(await deleteFolder(ctx.data.companyId, body.path));
        } catch (error) {
            return handleRouteError("folders.delete", error);
        }
    });
}
