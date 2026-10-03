/**
 * What the caller may share — folders and files they manage, chats they own.
 * Feeds the "Share something…" picker on a person's page in the Team tab.
 *
 * GET → { items: ShareableItem[] }
 */

import { NextResponse } from "next/server";

import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { workspaceErrorResponse } from "~/server/workspace/http";
import { listShareable } from "~/server/workspace/team/shareable";

export const dynamic = "force-dynamic";

export async function GET() {
    const ctx = await requireWorkspacePermission("documents.read");
    if (!ctx.success) return ctx.response;
    try {
        return NextResponse.json({ items: await listShareable(ctx.data) });
    } catch (error) {
        return workspaceErrorResponse(error, "[workspace/team/shareable GET]");
    }
}
