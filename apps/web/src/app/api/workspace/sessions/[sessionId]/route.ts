/**
 * One chat session — read it back, rename it, delete it.
 *
 * Reading is for anyone the chat reaches (ADR-014): its owner, or a person a
 * `workspace_session_grants` row reaches. A reader gets the live transcript
 * with citations outside their own scope removed (`hiddenCitations` counts
 * them) and `access.level: "view"`. Renaming and deleting stay the owner's.
 *
 * Every handler answers 404 for a session the caller can neither read nor
 * write — including a reader trying to rename or delete. A 403 would confirm
 * the uuid exists to someone who guessed it, and a reader already knows they
 * can't write: the UI never offers them the verb.
 */

import { NextResponse } from "next/server";

import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { serverError, UpdateSessionSchema, validateRequestBody } from "~/lib/validation";
import { readSession } from "~/server/sessions/reader";
import { deleteSession, updateSession } from "~/server/sessions/repository";
import { requestTranslator } from "~/i18n/server";

export const runtime = "nodejs";

type Params = { params: Promise<{ sessionId: string }> };

const notFound = (request: Request) =>
    NextResponse.json(
        { error: requestTranslator(request, "chat.server.sessions")("notFound") },
        { status: 404 }
    );

export async function GET(request: Request, { params }: Params) {
    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx.response;

    try {
        const session = await readSession(ctx.data, (await params).sessionId);
        return session ? NextResponse.json({ session }) : notFound(request);
    } catch (error) {
        console.error("[workspace/sessions] read failed:", error);
        return serverError(requestTranslator(request, "workspace.server.errors")("loadChatFailed"));
    }
}

export async function PATCH(request: Request, { params }: Params) {
    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx.response;

    const validation = await validateRequestBody(request, UpdateSessionSchema);
    if (!validation.success) return validation.response;

    try {
        const session = await updateSession(
            { companyId: ctx.data.companyId, userId: ctx.data.authUserId },
            (await params).sessionId,
            validation.data
        );
        return session ? NextResponse.json({ session }) : notFound(request);
    } catch (error) {
        console.error("[workspace/sessions] update failed:", error);
        return serverError(
            requestTranslator(request, "workspace.server.errors")("updateChatFailed")
        );
    }
}

export async function DELETE(request: Request, { params }: Params) {
    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx.response;

    try {
        const deleted = await deleteSession(
            { companyId: ctx.data.companyId, userId: ctx.data.authUserId },
            (await params).sessionId
        );
        return deleted ? NextResponse.json({ deleted: true }) : notFound(request);
    } catch (error) {
        console.error("[workspace/sessions] delete failed:", error);
        return serverError(
            requestTranslator(request, "workspace.server.errors")("deleteChatFailed")
        );
    }
}
