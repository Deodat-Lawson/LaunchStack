/**
 * PATCH /api/workspace/sessions/{id}/state — the caller's own organisation of
 * one chat (ADR-014 §5): `{ pinned?: boolean; archived?: boolean; seen?: true }`.
 *
 * For the owner or anyone the chat is shared with; it changes only the
 * caller's row in `workspace_session_user_state`, never anyone else's view. A
 * new pin goes to the top of the Pinned list; archiving unpins; pinning
 * unarchives. Answers `{ state }`, or 404 for a chat the caller cannot read.
 */

import { NextResponse } from "next/server";

import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { serverError, SessionStateSchema, validateRequestBody } from "~/lib/validation";
import { setSessionState } from "~/server/sessions/user-state";
import { requestTranslator } from "~/i18n/server";

export const runtime = "nodejs";

type Params = { params: Promise<{ sessionId: string }> };

export async function PATCH(request: Request, { params }: Params) {
    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx.response;
    const validation = await validateRequestBody(request, SessionStateSchema);
    if (!validation.success) return validation.response;
    try {
        const state = await setSessionState(ctx.data, (await params).sessionId, validation.data);
        return state
            ? NextResponse.json({ state })
            : NextResponse.json(
                  {
                      error: requestTranslator(request, "chat.server.sessions")("notFound"),
                  },
                  { status: 404 }
              );
    } catch (error) {
        console.error("[workspace/sessions] state update failed:", error);
        return serverError(
            requestTranslator(request, "workspace.server.errors")("updateChatFailed")
        );
    }
}
