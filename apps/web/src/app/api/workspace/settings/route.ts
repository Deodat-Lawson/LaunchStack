import { NextResponse } from "next/server";

import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { WorkspaceSettingsPatchSchema } from "~/lib/validation";
import { parseJsonBody, workspaceErrorResponse } from "~/server/workspace/http";
import { getSettings, updateSettings } from "~/server/workspace/settings";

export async function GET() {
    const ctx = await requireWorkspacePermission("settings.manage");
    if (!ctx.success) return ctx.response;
    try {
        return NextResponse.json(await getSettings(ctx.data));
    } catch (error) {
        return workspaceErrorResponse(error, "[workspace/settings GET]");
    }
}

export async function PATCH(request: Request) {
    const ctx = await requireWorkspacePermission("settings.manage");
    if (!ctx.success) return ctx.response;
    const body = await parseJsonBody(request, WorkspaceSettingsPatchSchema);
    if (!body.success) return body.response;
    try {
        return NextResponse.json(await updateSettings(ctx.data, body.data));
    } catch (error) {
        return workspaceErrorResponse(error, "[workspace/settings PATCH]");
    }
}
