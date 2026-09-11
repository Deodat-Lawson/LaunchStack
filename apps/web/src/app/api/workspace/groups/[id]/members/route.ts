import { NextResponse } from "next/server";

import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { GroupMembersSchema } from "~/lib/validation";
import { addGroupMembers, removeGroupMembers } from "~/server/workspace/groups";
import {
    invalidIdResponse,
    parseIdParam,
    parseJsonBody,
    workspaceErrorResponse,
} from "~/server/workspace/http";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
    const ctx = await requireWorkspacePermission("groups.manage");
    if (!ctx.success) return ctx.response;
    const id = parseIdParam((await params).id);
    if (id === null) return invalidIdResponse();
    const body = await parseJsonBody(request, GroupMembersSchema);
    if (!body.success) return body.response;
    try {
        return NextResponse.json({ group: await addGroupMembers(ctx.data, id, body.data.userIds) });
    } catch (error) {
        return workspaceErrorResponse(error, "[workspace/groups/members POST]");
    }
}

export async function DELETE(request: Request, { params }: Params) {
    const ctx = await requireWorkspacePermission("groups.manage");
    if (!ctx.success) return ctx.response;
    const id = parseIdParam((await params).id);
    if (id === null) return invalidIdResponse();
    const body = await parseJsonBody(request, GroupMembersSchema);
    if (!body.success) return body.response;
    try {
        return NextResponse.json({
            group: await removeGroupMembers(ctx.data, id, body.data.userIds),
        });
    } catch (error) {
        return workspaceErrorResponse(error, "[workspace/groups/members DELETE]");
    }
}
