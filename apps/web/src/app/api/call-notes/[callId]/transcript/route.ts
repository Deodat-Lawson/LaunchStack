import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { TranscriptSearchQuerySchema } from "@launchstack/features/call-notes";

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
    request: Request,
    { params }: { params: Promise<{ callId: string }> }
): Promise<Response> {
    try {
        const { userId } = await auth();
        if (!userId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { callId } = await params;
        const { searchParams } = new URL(request.url);
        const companyId = await getActiveCompanyId(userId);
        const parsed = TranscriptSearchQuerySchema.safeParse({
            companyId: companyId.toString(),
            actorUserId: userId,
            callId,
            query: searchParams.get("query"),
        });
        if (!parsed.success) return invalidRequest();

        const segments = await getWebCallNotesApplication().searchTranscript(parsed.data);
        return NextResponse.json(segments);
    } catch (error) {
        return callNotesErrorResponse(error);
    }
}
