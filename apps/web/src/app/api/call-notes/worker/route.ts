import { LocalCaptureWorkerStatusSchema } from "@launchstack/pipelines/call-notes";

import { env } from "~/env";
import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import {
    callNotesErrorResponse,
    getWebCallNotesApplication,
} from "~/server/call-notes/application";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
    try {
        const workspace = await requireWorkspacePermission("documents.read");
        if (!workspace.success) return workspace.response;
        const userId = workspace.data.authUserId;
        const companyId = workspace.data.companyId.toString();
        if (
            !env.server.CALL_NOTES_CAPTURE_ENABLED ||
            env.server.CALL_NOTES_LOCAL_COMPANY_ID !== companyId ||
            env.server.CALL_NOTES_LOCAL_USER_ID !== userId
        ) {
            return Response.json({ available: false, lastSeenAt: null });
        }
        const status = await getWebCallNotesApplication().getLocalCaptureWorkerStatus({
            companyId,
            userId,
        });
        return Response.json(LocalCaptureWorkerStatusSchema.parse(status));
    } catch (error) {
        return callNotesErrorResponse(error);
    }
}
