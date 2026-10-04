import { NextResponse } from "next/server";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import {
    ChatQueueSchema,
    ClaimChatQueueSchema,
    serverError,
    validateRequestBody,
} from "~/lib/validation";
import { changeQueue, getSession } from "~/server/sessions/repository";

export const runtime = "nodejs";
type Params = { params: Promise<{ sessionId: string }> };

export async function GET(_request: Request, { params }: Params) {
    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx.response;
    try {
        const session = await getSession(
            { companyId: ctx.data.companyId, userId: ctx.data.authUserId },
            (await params).sessionId
        );
        return session
            ? NextResponse.json({ items: session.queuedMessages, revision: session.queueRevision })
            : NextResponse.json({ error: "Session not found" }, { status: 404 });
    } catch {
        return serverError("Failed to load queued messages");
    }
}

async function update(request: Request, { params }: Params, claim: boolean) {
    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx.response;
    const validation = claim
        ? await validateRequestBody(request, ClaimChatQueueSchema)
        : await validateRequestBody(request, ChatQueueSchema);
    if (!validation.success) return validation.response;
    try {
        const data = validation.data;
        const result = await changeQueue(
            { companyId: ctx.data.companyId, userId: ctx.data.authUserId },
            (await params).sessionId,
            data.revision,
            "id" in data ? { claimId: data.id } : { items: data.items }
        );
        return result
            ? NextResponse.json(result, { status: result.conflict ? 409 : 200 })
            : NextResponse.json({ error: "Session not found" }, { status: 404 });
    } catch {
        return serverError("Failed to update queued messages");
    }
}
export async function PUT(request: Request, params: Params) {
    return update(request, params, false);
}
export async function POST(request: Request, params: Params) {
    return update(request, params, true);
}
