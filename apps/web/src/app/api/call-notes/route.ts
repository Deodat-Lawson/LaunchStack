import { NextResponse } from "next/server";

import {
    CallListQuerySchema,
    CallNotesApplicationError,
    CallNotesCommandSchema,
} from "@launchstack/pipelines/call-notes";
import { env } from "~/env";
import { requestTranslator } from "~/i18n/server";

import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import {
    callNotesErrorResponse,
    getWebCallNotesApplication,
} from "~/server/call-notes/application";
import { processQueuedCallNotesEnrichment } from "~/server/call-notes/enrichment-runner";
import { wakeCaptureCommand } from "~/server/call-notes/capture-control";

export const dynamic = "force-dynamic";

function invalidRequest(request: Request): NextResponse {
    return NextResponse.json(
        { error: requestTranslator(request, "calls.server")("invalidRequest") },
        { status: 400 }
    );
}

function localCaptureUnavailable(request: Request): NextResponse | null {
    if (!env.server.CALL_NOTES_CAPTURE_ENABLED) {
        return callNotesErrorResponse(
            new CallNotesApplicationError("unavailable", "Local capture is disabled"),
            request
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
        if (!parsed.success) return invalidRequest(request);

        const calls = await getWebCallNotesApplication().listCalls(parsed.data);
        return NextResponse.json(calls);
    } catch (error) {
        return callNotesErrorResponse(error, request);
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
            return invalidRequest(request);
        }

        // Actor, company, and capture source are always resolved server-side.
        const requestBody =
            body !== null && typeof body === "object" && !Array.isArray(body) ? body : {};
        if (
            "kind" in requestBody &&
            (requestBody.kind === "start_capture" || requestBody.kind === "resume_capture")
        ) {
            const unavailableResponse = localCaptureUnavailable(request);
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
        if (!parsed.success) return invalidRequest(request);

        let snapshot = await getWebCallNotesApplication().execute(parsed.data);
        await wakeCaptureCommand(parsed.data, snapshot);
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
        return callNotesErrorResponse(error, request);
    }
}
