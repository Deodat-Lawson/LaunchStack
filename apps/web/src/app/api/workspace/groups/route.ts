import { NextResponse } from "next/server";

import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { CreateGroupSchema } from "~/lib/validation";
import { createGroup, listGroups } from "~/server/workspace/groups";
import { parseJsonBody, workspaceErrorResponse } from "~/server/workspace/http";

export async function GET() {
    const ctx = await requireWorkspacePermission("members.view");
    if (!ctx.success) return ctx.response;
    try {
        return NextResponse.json({ groups: await listGroups(ctx.data) });
    } catch (error) {
        return workspaceErrorResponse(error, "[workspace/groups GET]");
    }
}

export async function POST(request: Request) {
    const ctx = await requireWorkspacePermission("groups.manage");
    if (!ctx.success) return ctx.response;
    const body = await parseJsonBody(request, CreateGroupSchema);
    if (!body.success) return body.response;
    try {
        return NextResponse.json(
            { group: await createGroup(ctx.data, body.data) },
            { status: 201 }
        );
    } catch (error) {
        return workspaceErrorResponse(error, "[workspace/groups POST]");
    }
}
