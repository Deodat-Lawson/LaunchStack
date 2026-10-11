/**
 * Mark inbox entries read.
 *
 * POST { ids?: number[] } → { success: true }
 *
 * With ids, only those; without, everything. Either way only the caller's own
 * entries change — an id from someone else's inbox matches nothing.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { parseValue, readOptionalJson, workspaceErrorResponse } from "~/server/workspace/http";
import { markNotificationsRead } from "~/server/workspace/notifications";

const MarkReadSchema = z.object({
    ids: z.array(z.number().int().positive()).max(500).optional(),
});

export async function POST(request: Request) {
    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx.response;
    const raw = await readOptionalJson(request);
    if (raw === null) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    const body = parseValue(raw, MarkReadSchema);
    if (!body.success) return body.response;
    try {
        await markNotificationsRead(ctx.data, body.data.ids);
        return NextResponse.json({ success: true });
    } catch (error) {
        return workspaceErrorResponse(error, "[workspace/notifications/read POST]");
    }
}
