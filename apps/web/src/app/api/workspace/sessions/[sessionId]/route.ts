/**
 * One chat session — read it back, rename or pin it, delete it.
 *
 * Every handler answers 404 for a session the caller does not own. That is
 * deliberate: a 403 would confirm the uuid exists and belongs to a colleague,
 * and there is nothing useful a caller can do with that fact.
 */

import { NextResponse } from "next/server";

import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { serverError, UpdateSessionSchema, validateRequestBody } from "~/lib/validation";
import { deleteSession, getSession, updateSession } from "~/server/sessions/repository";

export const runtime = "nodejs";

type Params = { params: Promise<{ sessionId: string }> };

const notFound = () => NextResponse.json({ error: "Session not found" }, { status: 404 });

export async function GET(_request: Request, { params }: Params) {
    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx.response;

    try {
        const session = await getSession(
            { companyId: ctx.data.companyId, userId: ctx.data.authUserId },
            (await params).sessionId
        );
        return session ? NextResponse.json({ session }) : notFound();
    } catch (error) {
        console.error("[workspace/sessions] read failed:", error);
        return serverError("Failed to load this chat");
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
        return session ? NextResponse.json({ session }) : notFound();
    } catch (error) {
        console.error("[workspace/sessions] update failed:", error);
        return serverError("Failed to update this chat");
    }
}

export async function DELETE(_request: Request, { params }: Params) {
    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx.response;

    try {
        const deleted = await deleteSession(
            { companyId: ctx.data.companyId, userId: ctx.data.authUserId },
            (await params).sessionId
        );
        return deleted ? NextResponse.json({ deleted: true }) : notFound();
    } catch (error) {
        console.error("[workspace/sessions] delete failed:", error);
        return serverError("Failed to delete this chat");
    }
}
