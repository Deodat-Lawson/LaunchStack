import { NextResponse } from "next/server";

import { setActiveWorkspaceCookie } from "~/lib/active-workspace";
import { AcceptJoinLinkSchema } from "~/lib/validation";
import { parseJsonBody, workspaceErrorResponse } from "~/server/workspace/http";
import { acceptJoinLink } from "~/server/workspace/join-links";
import { requireSessionUser } from "~/server/workspace/session";

export async function POST(request: Request) {
    const user = await requireSessionUser();
    if (!user.success) return user.response;
    const body = await parseJsonBody(request, AcceptJoinLinkSchema);
    if (!body.success) return body.response;
    try {
        const result = await acceptJoinLink(user.data, body.data);
        const response = NextResponse.json(result);
        // Only a workspace they can use. Pointing the cookie at one they're
        // still waiting on would strand them on a page that can't load.
        if (result.status === "active") {
            setActiveWorkspaceCookie(response, BigInt(result.companyId));
        }
        return response;
    } catch (error) {
        return workspaceErrorResponse(error, "[workspace/join-links/accept POST]");
    }
}
