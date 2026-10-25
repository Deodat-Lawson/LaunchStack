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
 * The rules live in `~/server/workspace/folder-actions`, shared with the
 * legacy `/api/Categories` routes. Each lands in the audit log and the team
 * activity feed. Folders are
 * paths (`~/lib/folders/path`), so a body carries the full path rather than an
 * id — a folder that exists only through the documents inside it has no row
 * to point at.
 */

import { z } from "zod";

import { localeOfRequest, requestTranslator } from "~/i18n/server";

import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";
import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { fail, handleRouteError, ok, readJson } from "~/server/api/responses";
import { FolderError, listVisibleFolders } from "~/server/folders";
import { folderErrorText } from "~/server/folders/words";
import { createFolderAs, deleteFolderAs, renameFolderAs } from "~/server/workspace/folder-actions";
import { accessSubject } from "~/server/workspace/item-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PathBody = z.object({ path: z.string().min(1).max(512) });
const RenameBody = z.object({
    path: z.string().min(1).max(512),
    newPath: z.string().min(1).max(512),
});

/** A folder rule's refusal in the reader's language; anything else as every route reports it. */
function folderRouteError(tag: string, error: unknown, request: Request) {
    if (error instanceof FolderError) {
        return fail(folderErrorText(error, localeOfRequest(request)), error.status, {
            code: error.code,
        });
    }
    return handleRouteError(tag, error, request);
}

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
            return folderRouteError("folders.list", error, request);
        }
    });
}

export async function POST(request: Request) {
    return withRateLimit(request, RateLimitPresets.standard, async () => {
        try {
            const ctx = await requireWorkspacePermission("documents.upload");
            if (!ctx.success) return ctx.response;

            const body = await parseBody(request, PathBody);
            if (!body) {
                return fail(
                    requestTranslator(request, "sources.server.folders")("pathRequired"),
                    400
                );
            }

            return ok(await createFolderAs(ctx.data, body.path), 201);
        } catch (error) {
            return folderRouteError("folders.create", error, request);
        }
    });
}

export async function PATCH(request: Request) {
    return withRateLimit(request, RateLimitPresets.standard, async () => {
        try {
            const ctx = await requireWorkspacePermission("documents.upload");
            if (!ctx.success) return ctx.response;

            const body = await parseBody(request, RenameBody);
            if (!body) {
                return fail(
                    requestTranslator(request, "sources.server.folders")("bothPathsRequired"),
                    400
                );
            }

            return ok(await renameFolderAs(ctx.data, body.path, body.newPath));
        } catch (error) {
            return folderRouteError("folders.rename", error, request);
        }
    });
}

export async function DELETE(request: Request) {
    return withRateLimit(request, RateLimitPresets.standard, async () => {
        try {
            const ctx = await requireWorkspacePermission("documents.upload");
            if (!ctx.success) return ctx.response;

            const body = await parseBody(request, PathBody);
            if (!body) {
                return fail(
                    requestTranslator(request, "sources.server.folders")("pathRequired"),
                    400
                );
            }

            return ok(await deleteFolderAs(ctx.data, body.path));
        } catch (error) {
            return folderRouteError("folders.delete", error, request);
        }
    });
}
