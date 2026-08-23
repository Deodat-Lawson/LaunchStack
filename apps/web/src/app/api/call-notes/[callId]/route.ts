import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { CallQuerySchema } from "@launchstack/features/call-notes";

import { getActiveCompanyId } from "~/lib/active-workspace";
import {
    callNotesErrorResponse,
    getWebCallNotesApplication,
} from "~/server/call-notes/application";

export const dynamic = "force-dynamic";

function invalidRequest(): NextResponse {
    return NextResponse.json({ error: "Invalid Call Notes request" }, { status: 400 });
}

export async function GET(
    _request: Request,
    { params }: { params: Promise<{ callId: string }> }
): Promise<Response> {
    try {
        const { userId } = await auth();
        if (!userId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { callId } = await params;
        const companyId = await getActiveCompanyId(userId);
        const parsed = CallQuerySchema.safeParse({
            companyId: companyId.toString(),
            actorUserId: userId,
            callId,
        });
        if (!parsed.success) return invalidRequest();

        const snapshot = await getWebCallNotesApplication().getCall(parsed.data);
        return NextResponse.json(snapshot);
    } catch (error) {
        return callNotesErrorResponse(error);
    }
}
