/**
 * POST /api/workspace/sessions/{id}/messages — append turns to a session.
 *
 * The client saves the question before generation and saves the completed or
 * stopped answer afterward, so the transcript tracks durable turns. A failed answer is stored too: "I couldn't reach the model" is part
 * of that conversation's history, and hiding it would make the reopened thread
 * a different thread.
 *
 * Owner only. Someone a chat is shared with (ADR-014) reads it but can't add
 * to it or rewind it: they get the same 404 a stranger does, and continue the
 * conversation through `POST …/fork` instead.
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
import { requestTranslator } from "~/i18n/server";

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
            : NextResponse.json(
                  {
                      error: requestTranslator(request, "chat.server.sessions")("notFound"),
                  },
                  { status: 404 }
              );
    } catch (error) {
        console.error("[workspace/sessions] append failed:", error);
        return serverError(
            requestTranslator(request, "workspace.server.errors")("saveMessageFailed")
        );
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
            return NextResponse.json(
                { error: requestTranslator(request, "chat.server.sessions")("notFound") },
                { status: 404 }
            );
        if (result === "conflict")
            return NextResponse.json(
                {
                    error: requestTranslator(
                        request,
                        "workspace.server.errors"
                    )("chatChangedElsewhere"),
                },
                { status: 409 }
            );
        return NextResponse.json({ truncated: true });
    } catch (error) {
        console.error("[workspace/sessions] rewind failed:", error);
        return serverError(requestTranslator(request, "workspace.server.errors")("rewindFailed"));
    }
}
