/**
 * The team's activity feed (ADR-014 §7).
 *
 * GET ?before=<id>&limit=<1-100>&actor=<auth user id>
 *   → { entries: FeedEntry[], nextBefore: number | null }
 *
 * Rows are filtered to what the caller can see now; `openable` says whether
 * the target is still there to click. `actor` narrows the feed to one person
 * (their page in the Team tab).
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { parseValue, queryObject, workspaceErrorResponse } from "~/server/workspace/http";
import { activityFeed } from "~/server/workspace/team/activity-feed";

export const dynamic = "force-dynamic";

const ActivityQuerySchema = z.object({
    before: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    actor: z.string().trim().min(1).max(256).optional(),
});

export async function GET(request: Request) {
    const ctx = await requireWorkspacePermission("documents.read");
    if (!ctx.success) return ctx.response;
    const query = parseValue(queryObject(request), ActivityQuerySchema);
    if (!query.success) return query.response;
    try {
        return NextResponse.json(
            await activityFeed(ctx.data, {
                before: query.data.before,
                limit: query.data.limit,
                actorUserId: query.data.actor,
            })
        );
    } catch (error) {
        return workspaceErrorResponse(error, "[workspace/activity GET]");
    }
}
