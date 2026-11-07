/**
 * POST /api/workspace/sessions/{id}/fork — "Continue in a new chat" (ADR-014).
 *
 * The owner or anyone it is shared with gets a new private chat of their own
 * holding a copy of the transcript, with citations filtered to what they can
 * open. Body: none. Answers 201 `{ id, title }`; 404 for a chat the caller
 * cannot read.
 */

import { NextResponse } from "next/server";

import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { serverError } from "~/lib/validation";
import { forkSession } from "~/server/sessions/fork";
import { requestTranslator } from "~/i18n/server";

export const runtime = "nodejs";

type Params = { params: Promise<{ sessionId: string }> };

export async function POST(request: Request, { params }: Params) {
    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx.response;
    try {
        const fork = await forkSession(ctx.data, (await params).sessionId);
        return fork
            ? NextResponse.json(fork, { status: 201 })
            : NextResponse.json(
                  {
                      error: requestTranslator(request, "chat.server.sessions")("notFound"),
                  },
                  { status: 404 }
              );
    } catch (error) {
        console.error("[workspace/sessions] fork failed:", error);
        return serverError(requestTranslator(request, "workspace.server.errors")("forkFailed"));
    }
}
