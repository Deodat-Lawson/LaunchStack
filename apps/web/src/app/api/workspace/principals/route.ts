import { NextResponse } from "next/server";

import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { workspaceErrorResponse } from "~/server/workspace/http";
import { searchPrincipals } from "~/server/workspace/principals";

export async function GET(request: Request) {
    const ctx = await requireWorkspacePermission("members.view");
    if (!ctx.success) return ctx.response;
    const q = new URL(request.url).searchParams.get("q") ?? "";
    try {
        return NextResponse.json(await searchPrincipals(ctx.data, q));
    } catch (error) {
        return workspaceErrorResponse(error, "[workspace/principals GET]");
    }
}
