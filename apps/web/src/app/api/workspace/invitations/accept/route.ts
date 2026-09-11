import { NextResponse } from "next/server";

import { setActiveWorkspaceCookie } from "~/lib/active-workspace";
import { AcceptInvitationSchema } from "~/lib/validation";
import { parseJsonBody, workspaceErrorResponse } from "~/server/workspace/http";
import { acceptInvitation } from "~/server/workspace/invitations";
import { requireSessionUser } from "~/server/workspace/session";

export async function POST(request: Request) {
    const user = await requireSessionUser();
    if (!user.success) return user.response;
    const body = await parseJsonBody(request, AcceptInvitationSchema);
    if (!body.success) return body.response;
    try {
        const result = await acceptInvitation(user.data, body.data);
        const response = NextResponse.json(result);
        setActiveWorkspaceCookie(response, BigInt(result.companyId));
        return response;
    } catch (error) {
        return workspaceErrorResponse(error, "[workspace/invitations/accept POST]");
    }
}
