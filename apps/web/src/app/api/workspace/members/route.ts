import { NextResponse } from "next/server";

import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { workspaceErrorResponse } from "~/server/workspace/http";
import { listMembers } from "~/server/workspace/members";

export async function GET() {
    const ctx = await requireWorkspacePermission("members.view");
    if (!ctx.success) return ctx.response;
    try {
        return NextResponse.json(await listMembers(ctx.data));
    } catch (error) {
        return workspaceErrorResponse(error, "[workspace/members GET]");
    }
}
