/**
 * Chat sessions — list and create.
 *
 * A session is created by the *first send*, never by opening the composer:
 * the opening question is what names it, and a session row with no turns is
 * a ghost in someone's sidebar. The client posts both turns of that first
 * exchange together and gets the session id back.
 */

import { NextResponse } from "next/server";

import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { CreateSessionSchema, serverError, validateRequestBody } from "~/lib/validation";
import { createSession, listSessions } from "~/server/sessions/repository";

export const runtime = "nodejs";

export async function GET(request: Request) {
    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx.response;

    try {
        const { searchParams } = new URL(request.url);
        const sessions = await listSessions(
            { companyId: ctx.data.companyId, userId: ctx.data.authUserId },
            { limit: Number(searchParams.get("limit")) || undefined }
        );
        return NextResponse.json({ sessions });
    } catch (error) {
        console.error("[workspace/sessions] list failed:", error);
        return serverError("Failed to load sessions");
    }
}

export async function POST(request: Request) {
    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx.response;

    const validation = await validateRequestBody(request, CreateSessionSchema);
    if (!validation.success) return validation.response;

    try {
        const session = await createSession(
            { companyId: ctx.data.companyId, userId: ctx.data.authUserId },
            validation.data
        );
        return NextResponse.json({ session }, { status: 201 });
    } catch (error) {
        console.error("[workspace/sessions] create failed:", error);
        return serverError("Failed to save this chat");
    }
}
