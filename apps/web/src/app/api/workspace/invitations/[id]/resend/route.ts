import { NextResponse } from "next/server";

import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import {
    invalidIdResponse,
    parseIdParam,
    requestOrigin,
    workspaceErrorResponse,
} from "~/server/workspace/http";
import { resendInvitation } from "~/server/workspace/invitations";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const ctx = await requireWorkspacePermission("members.invite");
    if (!ctx.success) return ctx.response;
    const id = parseIdParam((await params).id);
    if (id === null) return invalidIdResponse();
    try {
        return NextResponse.json(await resendInvitation(ctx.data, id, requestOrigin(request)));
    } catch (error) {
        return workspaceErrorResponse(error, "[workspace/invitations/resend POST]");
    }
}
