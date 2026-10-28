/**
 * A member's own usage: their numbers over the window, the workspace's median
 * for comparison and their streak. Any member may read their own — it needs
 * no `analytics.view` — and nothing in it names or counts anyone else.
 */

import { NextResponse } from "next/server";

import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import type { UsageMe } from "~/lib/usage/types";
import { readUsageQuery, usageMe } from "~/server/usage";
import { workspaceErrorResponse } from "~/server/workspace/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx.response;
    try {
        const query = readUsageQuery(new URL(request.url).searchParams);
        return NextResponse.json<UsageMe>(await usageMe(ctx.data, query.window));
    } catch (error) {
        return workspaceErrorResponse(error, "[usage/me GET]", request);
    }
}
