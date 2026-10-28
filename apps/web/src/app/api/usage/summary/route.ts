/**
 * The Usage tab's tiles and charts: the workspace's numbers, or one person's
 * (`person=<member id>`) or one group's (`group=<id>`), over a window
 * (`days`, or `from` and `to`). Gated on `analytics.view` like the rest of
 * the workspace's statistics; a member's own numbers are `/api/usage/me`.
 */

import { NextResponse } from "next/server";

import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import type { UsageSummary } from "~/lib/usage/types";
import { readUsageQuery, usageSummary } from "~/server/usage";
import { workspaceErrorResponse } from "~/server/workspace/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
    const ctx = await requireWorkspacePermission("analytics.view");
    if (!ctx.success) return ctx.response;
    try {
        const query = readUsageQuery(new URL(request.url).searchParams);
        return NextResponse.json<UsageSummary>(await usageSummary(ctx.data, query.window, query));
    } catch (error) {
        return workspaceErrorResponse(error, "[usage/summary GET]", request);
    }
}
