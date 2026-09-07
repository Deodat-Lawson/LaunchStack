import { NextResponse } from "next/server";

import { CallListQuerySchema } from "@launchstack/pipelines/call-notes";

import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import {
    callNotesErrorResponse,
    getWebCallNotesApplication,
} from "~/server/call-notes/application";

export const dynamic = "force-dynamic";

function invalidRequest(): NextResponse {
    return NextResponse.json({ error: "Invalid Call Notes request" }, { status: 400 });
}

export async function GET(request: Request): Promise<Response> {
    try {
        const workspace = await requireWorkspacePermission("documents.read");
        if (!workspace.success) return workspace.response;

        const { searchParams } = new URL(request.url);
        const rawLimit = searchParams.get("limit");
        const companyId = workspace.data.companyId.toString();
        const actorUserId = workspace.data.authUserId;
        const parsed = CallListQuerySchema.safeParse({
            companyId,
            actorUserId,
            limit: rawLimit === null ? undefined : Number(rawLimit),
        });
        if (!parsed.success) return invalidRequest();
        const candidates = await getWebCallNotesApplication().listDetectedCalls(parsed.data);
        return NextResponse.json(candidates);
    } catch (error) {
        return callNotesErrorResponse(error);
    }
}
