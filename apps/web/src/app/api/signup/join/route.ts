import { NextResponse } from "next/server";

import { setActiveWorkspaceCookie } from "~/lib/active-workspace";
import { JoinWithInviteSchema } from "~/lib/validation";
import { parseJsonBody, workspaceErrorResponse } from "~/server/workspace/http";
import { acceptJoinLink } from "~/server/workspace/join-links";
import { requireSessionUser } from "~/server/workspace/session";

/**
 * Alias of POST /api/workspace/join-links/accept for the signup form, which
 * posts `{ name, email, inviteCode }`. Already-registered accounts join too:
 * a person may belong to several workspaces. The session's email is the one
 * that counts; the body's is accepted for compatibility and not used.
 */
export async function POST(request: Request) {
    const user = await requireSessionUser();
    if (!user.success) return user.response;
    const body = await parseJsonBody(request, JoinWithInviteSchema);
    if (!body.success) return body.response;
    try {
        const result = await acceptJoinLink(user.data, {
            code: body.data.inviteCode,
            name: body.data.name,
        });
        const response = NextResponse.json(result);
        setActiveWorkspaceCookie(response, BigInt(result.companyId));
        return response;
    } catch (error) {
        return workspaceErrorResponse(error, "[signup/join POST]");
    }
}
