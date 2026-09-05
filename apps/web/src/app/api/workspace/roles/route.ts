import { NextResponse } from "next/server";

import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { CreateRoleSchema } from "~/lib/validation";
import { parseJsonBody, workspaceErrorResponse } from "~/server/workspace/http";
import { createRole, listRoles } from "~/server/workspace/roles";

export async function GET() {
    const ctx = await requireWorkspacePermission("members.view");
    if (!ctx.success) return ctx.response;
    try {
        return NextResponse.json(await listRoles(ctx.data));
    } catch (error) {
        return workspaceErrorResponse(error, "[workspace/roles GET]");
    }
}

export async function POST(request: Request) {
    const ctx = await requireWorkspacePermission("roles.manage");
    if (!ctx.success) return ctx.response;
    const body = await parseJsonBody(request, CreateRoleSchema);
    if (!body.success) return body.response;
    try {
        return NextResponse.json({ role: await createRole(ctx.data, body.data) }, { status: 201 });
    } catch (error) {
        return workspaceErrorResponse(error, "[workspace/roles POST]");
    }
}
