import { NextResponse } from "next/server";

import { DeclineInvitationSchema } from "~/lib/validation";
import { parseJsonBody, workspaceErrorResponse } from "~/server/workspace/http";
import { declineInvitation } from "~/server/workspace/invitations";
import { requireSessionUser } from "~/server/workspace/session";

/**
 * The invited person declines an invitation from their workspace list. Needs
 * a session whose email is the invitation's address; see declineInvitation.
 */
export async function POST(request: Request) {
    const user = await requireSessionUser();
    if (!user.success) return user.response;
    const body = await parseJsonBody(request, DeclineInvitationSchema);
    if (!body.success) return body.response;
    try {
        return NextResponse.json(await declineInvitation(user.data, body.data.invitationId));
    } catch (error) {
        return workspaceErrorResponse(error, "[workspace/invitations/decline POST]", request);
    }
}
