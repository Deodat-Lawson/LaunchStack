import { NextResponse } from "next/server";

import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { UpdateMemberSchema } from "~/lib/validation";
import {
    invalidIdResponse,
    parseIdParam,
    parseJsonBody,
    workspaceErrorResponse,
} from "~/server/workspace/http";
import { removeMember, updateMember } from "~/server/workspace/members";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
    const ctx = await requireWorkspacePermission("members.manage");
    if (!ctx.success) return ctx.response;
    const id = parseIdParam((await params).id);
    if (id === null) return invalidIdResponse();
    const body = await parseJsonBody(request, UpdateMemberSchema);
    if (!body.success) return body.response;
    try {
        return NextResponse.json(await updateMember(ctx.data, BigInt(id), body.data));
    } catch (error) {
        return workspaceErrorResponse(error, "[workspace/members PATCH]");
    }
}

export async function DELETE(_request: Request, { params }: Params) {
    const ctx = await requireWorkspacePermission("members.manage");
    if (!ctx.success) return ctx.response;
    const id = parseIdParam((await params).id);
    if (id === null) return invalidIdResponse();
    try {
        return NextResponse.json(await removeMember(ctx.data, BigInt(id)));
    } catch (error) {
        return workspaceErrorResponse(error, "[workspace/members DELETE]");
    }
}
