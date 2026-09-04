import { NextResponse } from "next/server";

import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { FolderAccessSchema } from "~/lib/validation";
import { getFolderAccess, setFolderAccess } from "~/server/workspace/folder-access";
import {
    invalidIdResponse,
    parseIdParam,
    parseJsonBody,
    workspaceErrorResponse,
} from "~/server/workspace/http";

type Params = { params: Promise<{ categoryId: string }> };

export async function GET(_request: Request, { params }: Params) {
    const ctx = await requireWorkspacePermission("documents.read");
    if (!ctx.success) return ctx.response;
    const id = parseIdParam((await params).categoryId);
    if (id === null) return invalidIdResponse();
    try {
        return NextResponse.json(await getFolderAccess(ctx.data, id));
    } catch (error) {
        return workspaceErrorResponse(error, "[workspace/folders/access GET]");
    }
}

/** `folders.manage`, or a manage-level grant on the folder — checked in the service. */
export async function PUT(request: Request, { params }: Params) {
    const ctx = await requireWorkspacePermission("documents.read");
    if (!ctx.success) return ctx.response;
    const id = parseIdParam((await params).categoryId);
    if (id === null) return invalidIdResponse();
    const body = await parseJsonBody(request, FolderAccessSchema);
    if (!body.success) return body.response;
    try {
        return NextResponse.json(await setFolderAccess(ctx.data, id, body.data));
    } catch (error) {
        return workspaceErrorResponse(error, "[workspace/folders/access PUT]");
    }
}
