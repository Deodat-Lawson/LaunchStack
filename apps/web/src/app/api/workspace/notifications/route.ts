/**
 * The caller's inbox (ADR-014): "Ada shared Q3 plan with you".
 *
 * GET ?limit= → { entries, unread }
 *
 * Every member has an inbox, Guests included — sharing with a Guest is how
 * they get anything at all. Entries are the caller's own, filtered to what
 * they can still open.
 */

import { NextResponse } from "next/server";

import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { workspaceErrorResponse } from "~/server/workspace/http";
import { listNotifications } from "~/server/workspace/notifications";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx.response;
    const raw = new URL(request.url).searchParams.get("limit");
    const limit = raw && /^\d{1,3}$/.test(raw) ? Number(raw) : undefined;
    try {
        return NextResponse.json(await listNotifications(ctx.data, { limit }));
    } catch (error) {
        return workspaceErrorResponse(error, "[workspace/notifications GET]");
    }
}
