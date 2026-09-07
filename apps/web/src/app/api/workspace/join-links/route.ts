import { NextResponse } from "next/server";

import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { CreateJoinLinkSchema } from "~/lib/validation";
import { parseJsonBody, requestOrigin, workspaceErrorResponse } from "~/server/workspace/http";
import { createJoinLink, listJoinLinks } from "~/server/workspace/join-links";

export async function GET(request: Request) {
    const ctx = await requireWorkspacePermission("members.invite");
    if (!ctx.success) return ctx.response;
    try {
        return NextResponse.json({ links: await listJoinLinks(ctx.data, requestOrigin(request)) });
    } catch (error) {
        return workspaceErrorResponse(error, "[workspace/join-links GET]");
    }
}

export async function POST(request: Request) {
    const ctx = await requireWorkspacePermission("members.invite");
    if (!ctx.success) return ctx.response;
    const body = await parseJsonBody(request, CreateJoinLinkSchema);
    if (!body.success) return body.response;
    try {
        const link = await createJoinLink(ctx.data, body.data, requestOrigin(request));
        return NextResponse.json({ link }, { status: 201 });
    } catch (error) {
        return workspaceErrorResponse(error, "[workspace/join-links POST]");
    }
}
