import { NextResponse } from "next/server";

import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { GroupMembersSchema } from "~/lib/validation";
import { addGroupMembers, removeGroupMembers } from "~/server/workspace/groups";
import {
    invalidIdResponse,
    parseIdParam,
    parseJsonBody,
    workspaceErrorResponse,
} from "~/server/workspace/http";

type Params = { params: Promise<{ id: string }> };

// The group's creator or a `groups.manage` holder may change who is in it; the
// service answers 403 for anyone else (ADR-014).

export async function POST(request: Request, { params }: Params) {
    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx.response;
    const id = parseIdParam((await params).id);
    if (id === null) return invalidIdResponse(request);
    const body = await parseJsonBody(request, GroupMembersSchema);
    if (!body.success) return body.response;
    try {
        return NextResponse.json({ group: await addGroupMembers(ctx.data, id, body.data.userIds) });
    } catch (error) {
        return workspaceErrorResponse(error, "[workspace/groups/members POST]", request);
    }
}

export async function DELETE(request: Request, { params }: Params) {
    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx.response;
    const id = parseIdParam((await params).id);
    if (id === null) return invalidIdResponse(request);
    const body = await parseJsonBody(request, GroupMembersSchema);
    if (!body.success) return body.response;
    try {
        return NextResponse.json({
            group: await removeGroupMembers(ctx.data, id, body.data.userIds),
        });
    } catch (error) {
        return workspaceErrorResponse(error, "[workspace/groups/members DELETE]", request);
    }
}
