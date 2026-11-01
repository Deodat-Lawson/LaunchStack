/**
 * The Usage tab's people table: every current member (or one group's,
 * `group=<id>`) with their numbers in the window and this month's AI
 * allowance, plus people who have left and work no one started, each as one
 * row. Who used how much is a workspace fact, so it is gated on
 * `analytics.view`, like Workspace › Usage's per-person limits.
 */

import { NextResponse } from "next/server";

import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import type { UsagePeople } from "~/lib/usage/types";
import { readUsageQuery, usagePeople } from "~/server/usage";
import { workspaceErrorResponse } from "~/server/workspace/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
    const ctx = await requireWorkspacePermission("analytics.view");
    if (!ctx.success) return ctx.response;
    try {
        const query = readUsageQuery(new URL(request.url).searchParams);
        return NextResponse.json<UsagePeople>(
            await usagePeople(ctx.data, query.window, { group: query.group })
        );
    } catch (error) {
        return workspaceErrorResponse(error, "[usage/people GET]", request);
    }
}
