import { NextResponse } from "next/server";

import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { CreateInvitationSchema } from "~/lib/validation";
import { parseJsonBody, requestOrigin, workspaceErrorResponse } from "~/server/workspace/http";
import { createInvitation, listInvitations } from "~/server/workspace/invitations";

export async function GET() {
    const ctx = await requireWorkspacePermission("members.invite");
    if (!ctx.success) return ctx.response;
    try {
        return NextResponse.json({ invitations: await listInvitations(ctx.data) });
    } catch (error) {
        return workspaceErrorResponse(error, "[workspace/invitations GET]");
    }
}

export async function POST(request: Request) {
    const ctx = await requireWorkspacePermission("members.invite");
    if (!ctx.success) return ctx.response;
    const body = await parseJsonBody(request, CreateInvitationSchema);
    if (!body.success) return body.response;
    try {
        const result = await createInvitation(ctx.data, body.data, requestOrigin(request));
        return NextResponse.json(result, { status: 201 });
    } catch (error) {
        return workspaceErrorResponse(error, "[workspace/invitations POST]");
    }
}
