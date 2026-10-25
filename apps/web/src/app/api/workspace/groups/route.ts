import { NextResponse } from "next/server";

import {
    requireWorkspaceContext,
    requireWorkspacePermission,
} from "~/lib/require-workspace-context";
import { CreateGroupSchema } from "~/lib/validation";
import { canCreateGroups, createGroup, listGroups } from "~/server/workspace/groups";
import { parseJsonBody, workspaceErrorResponse } from "~/server/workspace/http";
import { requestTranslator } from "~/i18n/server";

export async function GET(request: Request) {
    const ctx = await requireWorkspacePermission("members.view");
    if (!ctx.success) return ctx.response;
    try {
        return NextResponse.json({ groups: await listGroups(ctx.data) });
    } catch (error) {
        return workspaceErrorResponse(error, "[workspace/groups GET]", request);
    }
}

/**
 * Any non-guest who sees the member list may create a group and becomes its
 * manager (ADR-014) — the Share dialog's "New group…" relies on it.
 */
export async function POST(request: Request) {
    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx.response;
    if (!canCreateGroups(ctx.data)) {
        return NextResponse.json(
            { error: requestTranslator(request, "team.server.errors")("cannotCreateGroups") },
            { status: 403 }
        );
    }
    const body = await parseJsonBody(request, CreateGroupSchema);
    if (!body.success) return body.response;
    try {
        return NextResponse.json(
            { group: await createGroup(ctx.data, body.data) },
            { status: 201 }
        );
    } catch (error) {
        return workspaceErrorResponse(error, "[workspace/groups POST]", request);
    }
}
