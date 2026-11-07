import { NextResponse } from "next/server";

import { workspaceErrorResponse } from "~/server/workspace/http";
import { JOIN_CODE_MAX_LENGTH, previewJoinLink } from "~/server/workspace/join-links";

/**
 * Public (allow-listed in middleware): tells the /join page whether a join
 * code is usable, for which workspace, and who made it. Consumes nothing.
 */
export async function GET(request: Request) {
    const code = new URL(request.url).searchParams.get("code")?.trim() ?? "";
    if (!code || code.length > JOIN_CODE_MAX_LENGTH) {
        return NextResponse.json({ valid: false, reason: "unknown" });
    }
    try {
        return NextResponse.json(await previewJoinLink(code));
    } catch (error) {
        return workspaceErrorResponse(error, "[workspace/join-links/preview GET]", request);
    }
}
