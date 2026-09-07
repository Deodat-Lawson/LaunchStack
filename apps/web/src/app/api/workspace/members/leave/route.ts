import { NextResponse } from "next/server";

import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { workspaceErrorResponse } from "~/server/workspace/http";
import { leaveWorkspace } from "~/server/workspace/members";

export async function POST() {
    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx.response;
    try {
        return NextResponse.json(await leaveWorkspace(ctx.data));
    } catch (error) {
        return workspaceErrorResponse(error, "[workspace/members/leave POST]");
    }
}
