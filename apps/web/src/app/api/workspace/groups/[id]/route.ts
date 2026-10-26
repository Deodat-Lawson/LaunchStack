import { NextResponse } from "next/server";

import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { UpdateGroupSchema } from "~/lib/validation";
import { deleteGroup, updateGroup } from "~/server/workspace/groups";
import {
    invalidIdResponse,
    parseIdParam,
    parseJsonBody,
    workspaceErrorResponse,
} from "~/server/workspace/http";

type Params = { params: Promise<{ id: string }> };

// The group's creator or a `groups.manage` holder may change it; the service
// answers 403 for anyone else (ADR-014).

export async function PATCH(request: Request, { params }: Params) {
    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx.response;
    const id = parseIdParam((await params).id);
    if (id === null) return invalidIdResponse(request);
    const body = await parseJsonBody(request, UpdateGroupSchema);
    if (!body.success) return body.response;
    try {
        return NextResponse.json({ group: await updateGroup(ctx.data, id, body.data) });
    } catch (error) {
        return workspaceErrorResponse(error, "[workspace/groups PATCH]", request);
    }
}

export async function DELETE(request: Request, { params }: Params) {
    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx.response;
    const id = parseIdParam((await params).id);
    if (id === null) return invalidIdResponse(request);
    try {
        return NextResponse.json(await deleteGroup(ctx.data, id));
    } catch (error) {
        return workspaceErrorResponse(error, "[workspace/groups DELETE]", request);
    }
}
