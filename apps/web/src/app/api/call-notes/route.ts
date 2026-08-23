import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { CallListQuerySchema, CallNotesCommandSchema } from "@launchstack/features/call-notes";

import { getActiveCompanyId } from "~/lib/active-workspace";
import {
    callNotesErrorResponse,
    getWebCallNotesApplication,
} from "~/server/call-notes/application";

export const dynamic = "force-dynamic";

function invalidRequest(): NextResponse {
    return NextResponse.json({ error: "Invalid Call Notes request" }, { status: 400 });
}

async function authenticatedContext(): Promise<{ userId: string; companyId: string } | null> {
    const { userId } = await auth();
    if (!userId) return null;

    const companyId = await getActiveCompanyId(userId);
    return { userId, companyId: companyId.toString() };
}

export async function GET(request: Request): Promise<Response> {
    try {
        const context = await authenticatedContext();
        if (!context) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const rawLimit = searchParams.get("limit");
        const parsed = CallListQuerySchema.safeParse({
            companyId: context.companyId,
            actorUserId: context.userId,
            limit: rawLimit === null ? undefined : Number(rawLimit),
        });
        if (!parsed.success) return invalidRequest();

        const calls = await getWebCallNotesApplication().listCalls(parsed.data);
        return NextResponse.json(calls);
    } catch (error) {
        return callNotesErrorResponse(error);
    }
}

export async function POST(request: Request): Promise<Response> {
    try {
        const context = await authenticatedContext();
        if (!context) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        let body: unknown;
        try {
            body = await request.json();
        } catch {
            return invalidRequest();
        }

        // The request's actor and company are never trusted. Rebuilding these
        // fields here also prevents a valid command from crossing tenancy when
        // a client sends stale or malicious context values.
        const requestBody =
            body !== null && typeof body === "object" && !Array.isArray(body) ? body : {};
        const parsed = CallNotesCommandSchema.safeParse({
            ...requestBody,
            companyId: context.companyId,
            actorUserId: context.userId,
        });
        if (!parsed.success) return invalidRequest();

        const snapshot = await getWebCallNotesApplication().execute(parsed.data);
        return NextResponse.json(snapshot);
    } catch (error) {
        return callNotesErrorResponse(error);
    }
}
