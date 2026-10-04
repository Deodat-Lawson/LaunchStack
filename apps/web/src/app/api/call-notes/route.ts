import { NextResponse } from "next/server";

import {
    CallListQuerySchema,
    CallNotesApplicationError,
    CallNotesCommandSchema,
} from "@launchstack/pipelines/call-notes";
import { env } from "~/env";

import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import {
    callNotesErrorResponse,
    getWebCallNotesApplication,
} from "~/server/call-notes/application";
import { processQueuedCallNotesEnrichment } from "~/server/call-notes/enrichment-runner";

export const dynamic = "force-dynamic";

function invalidRequest(): NextResponse {
    return NextResponse.json({ error: "Invalid Call Notes request" }, { status: 400 });
}

function localCaptureUnavailable(context: {
    companyId: string;
    userId: string;
}): NextResponse | null {
    if (!env.server.CALL_NOTES_CAPTURE_ENABLED) {
        return callNotesErrorResponse(
            new CallNotesApplicationError("unavailable", "Local capture is disabled")
        ) as NextResponse;
    }
    const configuredCompanyId = env.server.CALL_NOTES_LOCAL_COMPANY_ID;
    const configuredUserId = env.server.CALL_NOTES_LOCAL_USER_ID;
    if (
        !configuredCompanyId ||
        !/^\d+$/.test(configuredCompanyId) ||
        !configuredUserId ||
        configuredCompanyId !== context.companyId ||
        configuredUserId !== context.userId
    ) {
        return callNotesErrorResponse(
            new CallNotesApplicationError(
                "unavailable",
                "No configured local capture worker serves this workspace user"
            )
        ) as NextResponse;
    }
    return null;
}

export async function GET(request: Request): Promise<Response> {
    try {
        const workspace = await requireWorkspacePermission("documents.read");
        if (!workspace.success) return workspace.response;
        const context = {
            userId: workspace.data.authUserId,
            companyId: workspace.data.companyId.toString(),
        };

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
        const workspace = await requireWorkspacePermission("documents.edit");
        if (!workspace.success) return workspace.response;
        const context = {
            userId: workspace.data.authUserId,
            companyId: workspace.data.companyId.toString(),
        };

        let body: unknown;
        try {
            body = await request.json();
        } catch {
            return invalidRequest();
        }

        // Actor, company, and capture source are always resolved server-side.
        const requestBody =
            body !== null && typeof body === "object" && !Array.isArray(body) ? body : {};
        if ("kind" in requestBody && requestBody.kind === "start_capture") {
            const unavailableResponse = localCaptureUnavailable(context);
            if (unavailableResponse) return unavailableResponse;
        }
        const parsed = CallNotesCommandSchema.safeParse({
            ...requestBody,
            companyId: context.companyId,
            actorUserId: context.userId,
            ...("kind" in requestBody && requestBody.kind === "start_capture"
                ? { source: "local_audio" }
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
