/**
 * The Usage tab's activity log: AI use by day, person, feature, route and
 * whose endpoint served it — never by model. Newest day first, a page at a
 * time (`offset`, `limit` up to 500), narrowed by `person=<member id>` and
 * `feature=<AiFeature>`. Gated on `analytics.view`.
 */

import { NextResponse } from "next/server";

import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import type { UsageActivity } from "~/lib/usage/types";
import { readUsageQuery, usageActivity } from "~/server/usage";
import { workspaceErrorResponse } from "~/server/workspace/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
    const ctx = await requireWorkspacePermission("analytics.view");
    if (!ctx.success) return ctx.response;
    try {
        const query = readUsageQuery(new URL(request.url).searchParams);
        return NextResponse.json<UsageActivity>(await usageActivity(ctx.data, query.window, query));
    } catch (error) {
        return workspaceErrorResponse(error, "[usage/activity GET]", request);
    }
}
