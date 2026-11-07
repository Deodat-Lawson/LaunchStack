import { NextResponse } from "next/server";

import { TranscriptSearchQuerySchema } from "@launchstack/pipelines/call-notes";

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
    request: Request,
    { params }: { params: Promise<{ callId: string }> }
): Promise<Response> {
    try {
        const workspace = await requireWorkspacePermission("documents.read");
        if (!workspace.success) return workspace.response;

        const { callId } = await params;
        const { searchParams } = new URL(request.url);
        const companyId = workspace.data.companyId.toString();
        const actorUserId = workspace.data.authUserId;
        const parsed = TranscriptSearchQuerySchema.safeParse({
            companyId,
            actorUserId,
            callId,
            query: searchParams.get("query"),
        });
        if (!parsed.success) return invalidRequest();
        const segments = await getWebCallNotesApplication().searchTranscript(parsed.data);
        return NextResponse.json(segments);
    } catch (error) {
        return callNotesErrorResponse(error);
    }
}
