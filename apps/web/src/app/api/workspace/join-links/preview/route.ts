import { NextResponse } from "next/server";

import { workspaceErrorResponse } from "~/server/workspace/http";
import { previewJoinLink } from "~/server/workspace/join-links";

/**
 * Public (allow-listed in middleware): tells the signup page whether a join
 * code is usable and for which workspace. Consumes nothing.
 */
export async function GET(request: Request) {
    const code = new URL(request.url).searchParams.get("code")?.trim() ?? "";
    if (!code || code.length > 12) {
        return NextResponse.json({ valid: false, reason: "unknown" });
    }
    try {
        return NextResponse.json(await previewJoinLink(code));
    } catch (error) {
        return workspaceErrorResponse(error, "[workspace/join-links/preview GET]");
    }
}
