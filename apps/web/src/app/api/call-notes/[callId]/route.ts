import { NextResponse } from "next/server";

import { CallQuerySchema } from "@launchstack/pipelines/call-notes";

import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import {
    callNotesErrorResponse,
    getWebCallNotesApplication,
} from "~/server/call-notes/application";

export const dynamic = "force-dynamic";

function invalidRequest(): NextResponse {
    return NextResponse.json({ error: "Invalid Call Notes request" }, { status: 400 });
}

export async function GET(
    _request: Request,
    { params }: { params: Promise<{ callId: string }> }
): Promise<Response> {
    try {
        const workspace = await requireWorkspacePermission("documents.read");
        if (!workspace.success) return workspace.response;

        const { callId } = await params;
        const companyId = workspace.data.companyId.toString();
        const actorUserId = workspace.data.authUserId;
        const parsed = CallQuerySchema.safeParse({
            companyId,
            actorUserId,
            callId,
        });
        if (!parsed.success) return invalidRequest();
        const snapshot = await getWebCallNotesApplication().getCall(parsed.data);
        return NextResponse.json(snapshot);
    } catch (error) {
        return callNotesErrorResponse(error);
    }
}
