import { NextResponse } from "next/server";

import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { UpdateJoinLinkSchema } from "~/lib/validation";
import {
    invalidIdResponse,
    parseIdParam,
    parseJsonBody,
    requestOrigin,
    workspaceErrorResponse,
} from "~/server/workspace/http";
import { revokeJoinLink, updateJoinLink } from "~/server/workspace/join-links";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const ctx = await requireWorkspacePermission("members.invite");
    if (!ctx.success) return ctx.response;
    const id = parseIdParam((await params).id);
    if (id === null) return invalidIdResponse();
    const body = await parseJsonBody(request, UpdateJoinLinkSchema);
    if (!body.success) return body.response;
    try {
        const link = await updateJoinLink(ctx.data, id, body.data, requestOrigin(request));
        return NextResponse.json({ link });
    } catch (error) {
        return workspaceErrorResponse(error, "[workspace/join-links PATCH]");
    }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
    const ctx = await requireWorkspacePermission("members.invite");
    if (!ctx.success) return ctx.response;
    const id = parseIdParam((await params).id);
    if (id === null) return invalidIdResponse();
    try {
        return NextResponse.json(await revokeJoinLink(ctx.data, id));
    } catch (error) {
        return workspaceErrorResponse(error, "[workspace/join-links DELETE]");
    }
}
