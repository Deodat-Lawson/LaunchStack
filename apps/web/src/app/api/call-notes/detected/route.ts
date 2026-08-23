import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { CallListQuerySchema } from "@launchstack/features/call-notes";

import { getActiveCompanyId } from "~/lib/active-workspace";
import {
    callNotesErrorResponse,
    getWebCallNotesApplication,
} from "~/server/call-notes/application";

export const dynamic = "force-dynamic";

function invalidRequest(): NextResponse {
    return NextResponse.json({ error: "Invalid Call Notes request" }, { status: 400 });
}

export async function GET(request: Request): Promise<Response> {
    try {
        const { userId } = await auth();
        if (!userId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const rawLimit = searchParams.get("limit");
        const companyId = await getActiveCompanyId(userId);
        const parsed = CallListQuerySchema.safeParse({
            companyId: companyId.toString(),
            actorUserId: userId,
            limit: rawLimit === null ? undefined : Number(rawLimit),
        });
        if (!parsed.success) return invalidRequest();

        const candidates = await getWebCallNotesApplication().listDetectedCalls(parsed.data);
        return NextResponse.json(candidates);
    } catch (error) {
        return callNotesErrorResponse(error);
    }
}
