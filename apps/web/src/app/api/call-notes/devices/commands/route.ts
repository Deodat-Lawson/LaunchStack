import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
    CALL_NOTES_SCHEMA_VERSION,
    CallNotesCommandSchema,
} from "@launchstack/pipelines/call-notes";

import { localeOfRequest } from "~/i18n/server";
import { translatorFor } from "~/i18n/translate";
import {
    callNotesErrorResponse,
    getWebCallNotesApplication,
} from "~/server/call-notes/application";
import { assertCaptureDeviceCall, wakeCaptureCommand } from "~/server/call-notes/capture-control";
import { requireCaptureDevice } from "~/server/call-notes/device-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DeviceCommandSchema = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("start_capture") }).strict(),
    z.object({ kind: z.literal("stop_capture"), callId: z.string().min(1).max(64) }).strict(),
    z.object({ kind: z.literal("pause_capture"), callId: z.string().min(1).max(64) }).strict(),
    z.object({ kind: z.literal("resume_capture"), callId: z.string().min(1).max(64) }).strict(),
]);

export async function POST(request: Request): Promise<Response> {
    const auth = await requireCaptureDevice(request);
    if (!auth.success) return auth.response;
    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return Response.json({ error: "invalid_request" }, { status: 400 });
    }
    const parsed = DeviceCommandSchema.safeParse(body);
    if (!parsed.success) return Response.json({ error: "invalid_request" }, { status: 400 });
    try {
        const context = auth.data;
        if (parsed.data.kind !== "start_capture" && parsed.data.kind !== "resume_capture") {
            await assertCaptureDeviceCall(context, parsed.data.callId);
        }
        const t = translatorFor(localeOfRequest(request), "calls.capture");
        const command = CallNotesCommandSchema.parse({
            ...parsed.data,
            schemaVersion: CALL_NOTES_SCHEMA_VERSION,
            requestId: randomUUID(),
            companyId: context.companyId,
            actorUserId: context.userId,
            ...(parsed.data.kind === "start_capture"
                ? {
                      source: "local_audio",
                      sourceOccurrenceKey: `capture:${context.deviceId}:${randomUUID()}`,
                      title: t("localCallTitle"),
                  }
                : {}),
            ...(parsed.data.kind === "start_capture" || parsed.data.kind === "resume_capture"
                ? { targetDeviceId: context.deviceId }
                : {}),
        });
        const snapshot = await getWebCallNotesApplication().execute(command);
        await wakeCaptureCommand(command, snapshot);
        return Response.json(snapshot);
    } catch (error) {
        return callNotesErrorResponse(error, request);
    }
}
