/**
 * Folder access, addressed by path.
 *
 * Folders are paths (`~/lib/folders/path`), and one that exists only through
 * the documents inside it — or as an implied ancestor — has no `category` row
 * for `/api/workspace/folders/[categoryId]/access` to point at. This route
 * takes the path instead: GET answers for stored and implied folders alike;
 * PUT stores the folder first when it has to (`folders.manage`), then
 * behaves exactly like the id-addressed route.
 *
 *   GET /api/workspace/folders/by-path?path=Finance%2FQ3
 *   PUT /api/workspace/folders/by-path  { path, visibility, grants }
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { FolderAccessSchema } from "~/lib/validation";
import { getFolderAccessByPath, setFolderAccessByPath } from "~/server/workspace/folder-access";
import { parseJsonBody, workspaceErrorResponse } from "~/server/workspace/http";

const PathSchema = z.string().trim().min(1).max(512);
const PutSchema = FolderAccessSchema.extend({ path: PathSchema });

export async function GET(request: Request) {
    const ctx = await requireWorkspacePermission("documents.read");
    if (!ctx.success) return ctx.response;
    const parsed = PathSchema.safeParse(new URL(request.url).searchParams.get("path"));
    if (!parsed.success) {
        return NextResponse.json({ error: "A folder path is required." }, { status: 400 });
    }
    try {
        return NextResponse.json(await getFolderAccessByPath(ctx.data, parsed.data));
    } catch (error) {
        return workspaceErrorResponse(error, "[workspace/folders/by-path GET]");
    }
}

/** `folders.manage`, or a manage-level grant on the folder — checked in the service. */
export async function PUT(request: Request) {
    const ctx = await requireWorkspacePermission("documents.read");
    if (!ctx.success) return ctx.response;
    const body = await parseJsonBody(request, PutSchema);
    if (!body.success) return body.response;
    const { path, ...input } = body.data;
    try {
        return NextResponse.json(await setFolderAccessByPath(ctx.data, path, input));
    } catch (error) {
        return workspaceErrorResponse(error, "[workspace/folders/by-path PUT]");
    }
}
