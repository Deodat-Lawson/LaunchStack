/**
 * The Usage tab's documents: how often each was opened in the window, and by
 * how many people. Only documents the caller may read are listed or counted —
 * a folder they have no grant to stays invisible here too. Gated on
 * `analytics.view`. `limit` caps the list (200 by default, 1,000 at most);
 * the totals cover every visible document.
 */

import { NextResponse } from "next/server";

import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import type { UsageDocuments } from "~/lib/usage/types";
import { DOCUMENTS_PAGE, readUsageQuery, usageDocuments } from "~/server/usage";
import { workspaceErrorResponse } from "~/server/workspace/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
    const ctx = await requireWorkspacePermission("analytics.view");
    if (!ctx.success) return ctx.response;
    try {
        const query = readUsageQuery(new URL(request.url).searchParams, DOCUMENTS_PAGE);
        return NextResponse.json<UsageDocuments>(
            await usageDocuments(ctx.data, query.window, { limit: query.limit })
        );
    } catch (error) {
        return workspaceErrorResponse(error, "[usage/documents GET]", request);
    }
}
