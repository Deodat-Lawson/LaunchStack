/**
 * POST /api/workspace/sessions/{id}/messages — append turns to a session.
 *
 * The client saves the question before generation and saves the completed or
 * stopped answer afterward, so the transcript tracks durable turns. A failed answer is stored too: "I couldn't reach the model" is part
 * of that conversation's history, and hiding it would make the reopened thread
 * a different thread.
 */

import { NextResponse } from "next/server";

import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import {
    AppendSessionMessagesSchema,
    TruncateSessionSchema,
    serverError,
    validateRequestBody,
} from "~/lib/validation";
import { appendMessages, truncateMessages } from "~/server/sessions/repository";

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

export async function DELETE(request: Request, { params }: Params) {
    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx.response;
    const validation = await validateRequestBody(request, TruncateSessionSchema);
    if (!validation.success) return validation.response;
    try {
        const result = await truncateMessages(
            { companyId: ctx.data.companyId, userId: ctx.data.authUserId },
            (await params).sessionId,
            validation.data.keepCount,
            validation.data.expectedCount
        );
        if (result === "missing")
            return NextResponse.json({ error: "Session not found" }, { status: 404 });
        if (result === "conflict")
            return NextResponse.json(
                { error: "This chat changed in another tab. Reopen it before editing." },
                { status: 409 }
            );
        return NextResponse.json({ truncated: true });
    } catch (error) {
        console.error("[workspace/sessions] rewind failed:", error);
        return serverError("Failed to rewind this chat");
    }
}
