/**
 * DELETE /api/workspace/history/<kind>/<refId> — remove one history row.
 *
 * The rail had no way to delete anything that was not a chat: a partner
 * discovery run, a trend search, a repo explainer job all stayed in the
 * sidebar forever, and the only menu item they offered was "Open". This is
 * the endpoint behind the delete they now have.
 *
 * Routing by kind keeps the sidebar ignorant of every vertical's table, which
 * is the same contract the GET feed is built on. The dispatch lives in
 * `~/server/history`; this file is auth, validation and status codes.
 */

import { NextResponse } from "next/server";

import { isHistoryKind } from "~/lib/workspace-history";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { serverError } from "~/lib/validation";
import { deleteHistoryEntry } from "~/server/history";

export const runtime = "nodejs";

export async function DELETE(
    _request: Request,
    { params }: { params: Promise<{ kind: string; refId: string }> }
) {
    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx.response;

    const { kind, refId } = await params;
    if (!isHistoryKind(kind)) {
        return NextResponse.json({ error: "Unknown history kind" }, { status: 400 });
    }
    // Chat sessions are personal, not workspace-scoped, and have their own
    // delete. Routing them through here would apply the wrong ownership rule.
    if (kind === "chat") {
        return NextResponse.json(
            { error: "Delete a chat through the sessions API" },
            { status: 400 }
        );
    }

    const decoded = decodeURIComponent(refId);
    if (!decoded) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    try {
        const deleted = await deleteHistoryEntry({
            companyId: ctx.data.companyId,
            userId: ctx.data.authUserId,
            kind,
            refId: decoded,
        });
        // Nothing matched: either it is gone already or it belongs to another
        // workspace. The client is told the same thing either way.
        if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 });
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("[workspace/history] delete failed:", error);
        return serverError("Failed to delete this item");
    }
}
