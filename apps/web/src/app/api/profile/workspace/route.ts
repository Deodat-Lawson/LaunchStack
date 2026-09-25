/**
 * How the caller appears in the active workspace only.
 *
 * PATCH  — display name / title for this workspace (null = use my profile).
 * DELETE — drop every override here, photo included.
 *
 * No permission beyond an active membership: it is your own membership row.
 */

import { NextResponse } from "next/server";

import { WorkspaceProfilePatchSchema } from "~/lib/profile/fields";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import type { ProfileCaller } from "~/server/profile/store";
import { clearWorkspaceOverride, updateWorkspaceOverride } from "~/server/profile/store";
import { parseJsonBody, workspaceErrorResponse } from "~/server/workspace/http";

export const dynamic = "force-dynamic";

async function workspaceCaller() {
    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx;
    const caller: ProfileCaller = {
        userPk: ctx.data.userPk,
        authUserId: ctx.data.authUserId,
        companyId: ctx.data.companyId,
    };
    return { success: true as const, data: caller };
}

export async function PATCH(request: Request) {
    const caller = await workspaceCaller();
    if (!caller.success) return caller.response;
    const body = await parseJsonBody(request, WorkspaceProfilePatchSchema);
    if (!body.success) return body.response;
    try {
        return NextResponse.json(await updateWorkspaceOverride(caller.data, body.data));
    } catch (error) {
        return workspaceErrorResponse(error, "[profile/workspace PATCH]");
    }
}

export async function DELETE() {
    const caller = await workspaceCaller();
    if (!caller.success) return caller.response;
    try {
        return NextResponse.json(await clearWorkspaceOverride(caller.data));
    } catch (error) {
        return workspaceErrorResponse(error, "[profile/workspace DELETE]");
    }
}
