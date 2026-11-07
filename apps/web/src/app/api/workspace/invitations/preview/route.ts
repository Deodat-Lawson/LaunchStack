import { NextResponse } from "next/server";

import { workspaceErrorResponse } from "~/server/workspace/http";
import { previewInvitation } from "~/server/workspace/invitations";
import { requestTranslator } from "~/i18n/server";

/**
 * Public (allow-listed in middleware): shows an invitee what they were
 * invited to before they have an account. Returns no ids of anything.
 */
export async function GET(request: Request) {
    const token = new URL(request.url).searchParams.get("token")?.trim() ?? "";
    if (!token || token.length > 256) {
        return NextResponse.json(
            { error: requestTranslator(request, "team.server.errors")("invitationTokenRequired") },
            { status: 400 }
        );
    }
    try {
        return NextResponse.json(await previewInvitation(token));
    } catch (error) {
        return workspaceErrorResponse(error, "[workspace/invitations/preview GET]", request);
    }
}
