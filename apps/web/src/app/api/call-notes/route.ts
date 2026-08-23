import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";

import {
    CallListQuerySchema,
    CallNotesCommandSchema,
    callNotesZoomConnections,
} from "@launchstack/features/call-notes";

import { getActiveCompanyId } from "~/lib/active-workspace";
import {
    callNotesErrorResponse,
    getWebCallNotesApplication,
} from "~/server/call-notes/application";
import { processQueuedCallNotesEnrichment } from "~/server/call-notes/enrichment-runner";
import { getEngine } from "~/server/engine";

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

        // Actor, company, and Zoom authorization are always resolved server-side.
        const requestBody =
            body !== null && typeof body === "object" && !Array.isArray(body) ? body : {};
        const [connection] =
            "kind" in requestBody && requestBody.kind === "start_capture"
                ? await getEngine()
                      .db.select({ id: callNotesZoomConnections.id })
                      .from(callNotesZoomConnections)
                      .where(
                          and(
                              eq(callNotesZoomConnections.companyId, BigInt(context.companyId)),
                              eq(callNotesZoomConnections.userId, context.userId),
                              eq(callNotesZoomConnections.status, "active")
                          )
                      )
                      .limit(1)
                : [];
        const parsed = CallNotesCommandSchema.safeParse({
            ...requestBody,
            companyId: context.companyId,
            actorUserId: context.userId,
            ...("kind" in requestBody && requestBody.kind === "start_capture"
                ? { authorizationRef: connection?.id }
                : {}),
        });
        if (!parsed.success) return invalidRequest();

        let snapshot = await getWebCallNotesApplication().execute(parsed.data);
        if (parsed.data.kind === "request_enrichment" && snapshot) {
            await processQueuedCallNotesEnrichment(context.companyId, snapshot.id);
            snapshot = await getWebCallNotesApplication().getCall({
                companyId: context.companyId,
                actorUserId: context.userId,
                callId: snapshot.id,
            });
        }
        return NextResponse.json(snapshot);
    } catch (error) {
        return callNotesErrorResponse(error);
    }
}
