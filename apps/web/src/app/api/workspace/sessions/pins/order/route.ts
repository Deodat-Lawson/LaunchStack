/**
 * POST /api/workspace/sessions/pins/order — reorder the caller's pinned chats.
 *
 * Body `{ ids: string[] }`, top first. Rewrites only the caller's own
 * `workspace_session_user_state` rows; ids they haven't pinned are ignored and
 * pins they didn't list keep their relative order below the listed ones.
 * Answers `{ ids }` — the order now stored.
 *
 * A static segment, so it wins over `[sessionId]` (session ids are uuids).
 */

import { NextResponse } from "next/server";

import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { PinOrderSchema, serverError, validateRequestBody } from "~/lib/validation";
import { reorderPins } from "~/server/sessions/user-state";

export const runtime = "nodejs";

export async function POST(request: Request) {
    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx.response;
    const validation = await validateRequestBody(request, PinOrderSchema);
    if (!validation.success) return validation.response;
    try {
        return NextResponse.json({ ids: await reorderPins(ctx.data, validation.data.ids) });
    } catch (error) {
        console.error("[workspace/sessions] pin reorder failed:", error);
        return serverError("Failed to reorder pinned chats");
    }
}
