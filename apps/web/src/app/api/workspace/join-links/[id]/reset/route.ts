import { NextResponse } from "next/server";

import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import {
    invalidIdResponse,
    parseIdParam,
    requestOrigin,
    workspaceErrorResponse,
} from "~/server/workspace/http";
import { resetJoinLink } from "~/server/workspace/join-links";

/** Swaps the link for a fresh code with the same terms; the old URL stops working. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const ctx = await requireWorkspacePermission("members.invite");
    if (!ctx.success) return ctx.response;
    const id = parseIdParam((await params).id);
    if (id === null) return invalidIdResponse();
    try {
        const link = await resetJoinLink(ctx.data, id, requestOrigin(request));
        return NextResponse.json({ link }, { status: 201 });
    } catch (error) {
        return workspaceErrorResponse(error, "[workspace/join-links/reset POST]");
    }
}
