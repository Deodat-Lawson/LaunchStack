import { NextResponse } from "next/server";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import {
    ChatQueueSchema,
    ClaimChatQueueSchema,
    serverError,
    validateRequestBody,
} from "~/lib/validation";
import { changeQueue, getSession } from "~/server/sessions/repository";
import { requestTranslator } from "~/i18n/server";

export const runtime = "nodejs";
type Params = { params: Promise<{ sessionId: string }> };

export async function GET(request: Request, { params }: Params) {
    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx.response;
    try {
        const session = await getSession(
            { companyId: ctx.data.companyId, userId: ctx.data.authUserId },
            (await params).sessionId
        );
        return session
            ? NextResponse.json({ items: session.queuedMessages, revision: session.queueRevision })
            : NextResponse.json(
                  {
                      error: requestTranslator(request, "chat.server.sessions")("notFound"),
                  },
                  { status: 404 }
              );
    } catch {
        return serverError(
            requestTranslator(request, "workspace.server.errors")("loadQueueFailed")
        );
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
            : NextResponse.json(
                  {
                      error: requestTranslator(request, "chat.server.sessions")("notFound"),
                  },
                  { status: 404 }
              );
    } catch {
        return serverError(
            requestTranslator(request, "workspace.server.errors")("updateQueueFailed")
        );
    }
}
export async function PUT(request: Request, params: Params) {
    return update(request, params, false);
}
export async function POST(request: Request, params: Params) {
    return update(request, params, true);
}
