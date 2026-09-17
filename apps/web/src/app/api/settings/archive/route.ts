/**
 * The archive: list what is put away (applying the trash retention window on
 * the way), restore a batch, or delete a batch for good. Reading and
 * restoring need `settings.manage`; deleting for good also needs
 * `documents.delete`, the permission that already guards the irreversible.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import {
    forbiddenForPermission,
    requireWorkspacePermission,
} from "~/lib/require-workspace-context";
import { applyArchiveAction, archiveOverview } from "~/server/settings/archive";
import { parseJsonBody, workspaceErrorResponse } from "~/server/workspace/http";

export const dynamic = "force-dynamic";

const ActionSchema = z.object({
    action: z.enum(["restore", "delete"]),
    items: z
        .array(
            z.object({
                kind: z.enum(["mindmap", "artifact", "agent", "channel"]),
                id: z.string().min(1).max(128),
            })
        )
        .min(1)
        .max(200),
});

export async function GET() {
    const ctx = await requireWorkspacePermission("settings.manage");
    if (!ctx.success) return ctx.response;
    try {
        return NextResponse.json(await archiveOverview(ctx.data.companyId));
    } catch (error) {
        return workspaceErrorResponse(error, "[settings/archive GET]");
    }
}

export async function POST(request: Request) {
    const ctx = await requireWorkspacePermission("settings.manage");
    if (!ctx.success) return ctx.response;
    const body = await parseJsonBody(request, ActionSchema);
    if (!body.success) return body.response;
    if (body.data.action === "delete" && !ctx.data.can("documents.delete")) {
        return forbiddenForPermission("documents.delete");
    }
    try {
        return NextResponse.json(await applyArchiveAction(ctx.data, body.data));
    } catch (error) {
        return workspaceErrorResponse(error, "[settings/archive POST]");
    }
}
