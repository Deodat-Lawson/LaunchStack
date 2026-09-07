import { NextResponse } from "next/server";

import { listWorkspaceCallNoteFiles } from "~/server/call-notes/files";
import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { callNotesErrorResponse } from "~/server/call-notes/application";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
    try {
        const workspace = await requireWorkspacePermission("documents.read");
        if (!workspace.success) return workspace.response;
        const files = await listWorkspaceCallNoteFiles({
            actorUserId: workspace.data.authUserId,
            companyId: workspace.data.companyId.toString(),
        });
        return NextResponse.json(files);
    } catch (error) {
        return callNotesErrorResponse(error);
    }
}
