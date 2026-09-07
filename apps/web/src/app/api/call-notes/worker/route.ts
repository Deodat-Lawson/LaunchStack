import { auth } from "@clerk/nextjs/server";
import { LocalCaptureWorkerStatusSchema } from "@launchstack/features/call-notes";

import { env } from "~/env";
import { getActiveCompanyId } from "~/lib/active-workspace";
import {
    callNotesErrorResponse,
    getWebCallNotesApplication,
} from "~/server/call-notes/application";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
    try {
        const { userId } = await auth();
        if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
        const companyId = (await getActiveCompanyId(userId)).toString();
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
