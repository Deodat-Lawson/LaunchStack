/**
 * Each member's AI use this month and the limit that applies to them, for
 * Settings › Usage. Gated like the rest of that page, on `analytics.view`:
 * who used how much is the same kind of workspace fact as what it spent.
 */

import { NextResponse } from "next/server";

import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { memberAllowances } from "~/server/ai-usage/members";
import { workspaceErrorResponse } from "~/server/workspace/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
    const ctx = await requireWorkspacePermission("analytics.view");
    if (!ctx.success) return ctx.response;
    try {
        return NextResponse.json({
            ...(await memberAllowances(ctx.data)),
            canEdit: ctx.data.can("settings.manage"),
        });
    } catch (error) {
        return workspaceErrorResponse(error, "[settings/usage/members GET]", request);
    }
}
