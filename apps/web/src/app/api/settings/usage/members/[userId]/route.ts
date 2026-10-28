/**
 * Set one member's monthly AI limit: back to the workspace default, none, or
 * a number of tokens. `settings.manage`, like the workspace default itself.
 */

import { NextResponse } from "next/server";

import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { memberLimitChoiceSchema, updateMemberLimit } from "~/server/ai-usage/members";
import { parseJsonBody, workspaceErrorResponse } from "~/server/workspace/http";

export const dynamic = "force-dynamic";

export async function PUT(request: Request, { params }: { params: Promise<{ userId: string }> }) {
    const ctx = await requireWorkspacePermission("settings.manage");
    if (!ctx.success) return ctx.response;
    const body = await parseJsonBody(request, memberLimitChoiceSchema);
    if (!body.success) return body.response;
    try {
        const { userId } = await params;
        return NextResponse.json({
            member: await updateMemberLimit(ctx.data, decodeURIComponent(userId), body.data),
        });
    } catch (error) {
        return workspaceErrorResponse(error, "[settings/usage/members PUT]", request);
    }
}
