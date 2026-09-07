/**
 * POST /api/workspace/sessions/{id}/messages — append turns to a session.
 *
 * The client sends the question and its answer together, once the answer has
 * arrived, so the stored transcript always matches what the person saw on
 * screen. A failed answer is stored too: "I couldn't reach the model" is part
 * of that conversation's history, and hiding it would make the reopened thread
 * a different thread.
 */

import { NextResponse } from "next/server";

import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { AppendSessionMessagesSchema, serverError, validateRequestBody } from "~/lib/validation";
import { appendMessages } from "~/server/sessions/repository";

export const runtime = "nodejs";

type Params = { params: Promise<{ sessionId: string }> };

export async function POST(request: Request, { params }: Params) {
    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx.response;

    const validation = await validateRequestBody(request, AppendSessionMessagesSchema);
    if (!validation.success) return validation.response;

    try {
        const session = await appendMessages(
            { companyId: ctx.data.companyId, userId: ctx.data.authUserId },
            (await params).sessionId,
            validation.data
        );
        return session
            ? NextResponse.json({ session })
            : NextResponse.json({ error: "Session not found" }, { status: 404 });
    } catch (error) {
        console.error("[workspace/sessions] append failed:", error);
        return serverError("Failed to save this message");
    }
}
