import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { listWorkspaceCallNoteFiles } from "~/server/call-notes/files";
import { getActiveCompanyId } from "~/lib/active-workspace";
import { callNotesErrorResponse } from "~/server/call-notes/application";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
    try {
        const { userId } = await auth();
        if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        const companyId = await getActiveCompanyId(userId);
        const files = await listWorkspaceCallNoteFiles({
            actorUserId: userId,
            companyId: companyId.toString(),
        });
        return NextResponse.json(files);
    } catch (error) {
        return callNotesErrorResponse(error);
    }
}
