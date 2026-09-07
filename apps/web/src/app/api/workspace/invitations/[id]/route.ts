import { NextResponse } from "next/server";

import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { invalidIdResponse, parseIdParam, workspaceErrorResponse } from "~/server/workspace/http";
import { revokeInvitation } from "~/server/workspace/invitations";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
    const ctx = await requireWorkspacePermission("members.invite");
    if (!ctx.success) return ctx.response;
    const id = parseIdParam((await params).id);
    if (id === null) return invalidIdResponse();
    try {
        return NextResponse.json(await revokeInvitation(ctx.data, id));
    } catch (error) {
        return workspaceErrorResponse(error, "[workspace/invitations DELETE]");
    }
}
