/**
 * The usage page's data. Gated on `analytics.view`, the existing permission
 * for "the statistics dashboard" — burn is a workspace-level fact, and the
 * open question of showing it to every member is answered conservatively.
 */

import { NextResponse } from "next/server";

import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { usageOverview } from "~/server/settings/usage";
import { workspaceErrorResponse } from "~/server/workspace/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
    const ctx = await requireWorkspacePermission("analytics.view");
    if (!ctx.success) return ctx.response;
    try {
        const days = Number(new URL(request.url).searchParams.get("days")) || 30;
        return NextResponse.json(await usageOverview(ctx.data.companyId, days));
    } catch (error) {
        return workspaceErrorResponse(error, "[settings/usage GET]");
    }
}
