/**
 * The current workspace's own details — Workspace › General.
 *
 * GET   — anyone in the workspace: what it is called, its URL, description,
 *         industry, team size and colour, and whether they may change them.
 * PATCH — `settings.manage`: any subset of those. A URL another workspace
 *         holds is a 409 naming the field; every change is audited.
 */

import { NextResponse } from "next/server";

import {
    requireWorkspaceContext,
    requireWorkspacePermission,
} from "~/lib/require-workspace-context";
import {
    WorkspaceDetailsPatchSchema,
    type WorkspaceDetailsResponse,
} from "~/lib/workspace-details";
import { getWorkspaceDetails, updateWorkspaceDetails } from "~/server/workspace/details";
import { parseJsonBody, workspaceErrorResponse } from "~/server/workspace/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx.response;
    try {
        const body: WorkspaceDetailsResponse = {
            workspace: await getWorkspaceDetails(ctx.data),
            canEdit: ctx.data.can("settings.manage"),
        };
        return NextResponse.json(body);
    } catch (error) {
        return workspaceErrorResponse(error, "[workspace/details GET]", request);
    }
}

export async function PATCH(request: Request) {
    const ctx = await requireWorkspacePermission("settings.manage");
    if (!ctx.success) return ctx.response;
    const body = await parseJsonBody(request, WorkspaceDetailsPatchSchema);
    if (!body.success) return body.response;
    try {
        const workspace = await updateWorkspaceDetails(ctx.data, body.data);
        return NextResponse.json({ workspace });
    } catch (error) {
        return workspaceErrorResponse(error, "[workspace/details PATCH]", request);
    }
}
