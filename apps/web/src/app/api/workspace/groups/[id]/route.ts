import { NextResponse } from "next/server";

import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { UpdateGroupSchema } from "~/lib/validation";
import { deleteGroup, updateGroup } from "~/server/workspace/groups";
import {
    invalidIdResponse,
    parseIdParam,
    parseJsonBody,
    workspaceErrorResponse,
} from "~/server/workspace/http";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
    const ctx = await requireWorkspacePermission("groups.manage");
    if (!ctx.success) return ctx.response;
    const id = parseIdParam((await params).id);
    if (id === null) return invalidIdResponse();
    const body = await parseJsonBody(request, UpdateGroupSchema);
    if (!body.success) return body.response;
    try {
        return NextResponse.json({ group: await updateGroup(ctx.data, id, body.data) });
    } catch (error) {
        return workspaceErrorResponse(error, "[workspace/groups PATCH]");
    }
}

export async function DELETE(_request: Request, { params }: Params) {
    const ctx = await requireWorkspacePermission("groups.manage");
    if (!ctx.success) return ctx.response;
    const id = parseIdParam((await params).id);
    if (id === null) return invalidIdResponse();
    try {
        return NextResponse.json(await deleteGroup(ctx.data, id));
    } catch (error) {
        return workspaceErrorResponse(error, "[workspace/groups DELETE]");
    }
}
