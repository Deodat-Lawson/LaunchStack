/**
 * The caller's own AI allowance in the active workspace: what they used this
 * month, the limit that binds, and when it resets. Any member may read their
 * own; the chat composer and Settings › Account show it.
 */

import { NextResponse } from "next/server";

import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { loadAiAllowance } from "~/server/workspace-models/scope";
import { workspaceErrorResponse } from "~/server/workspace/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx.response;
    try {
        return NextResponse.json({
            allowance: await loadAiAllowance(ctx.data.companyId, ctx.data.authUserId),
        });
    } catch (error) {
        return workspaceErrorResponse(error, "[ai-allowance GET]", request);
    }
}
