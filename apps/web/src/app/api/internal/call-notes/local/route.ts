import { createHash } from "node:crypto";

import { after, NextResponse } from "next/server";
import { z } from "zod";

import {
    AudioChannelSchema,
    CALL_NOTES_SCHEMA_VERSION,
    LocalCapturePollInputSchema,
    LocalCapturePollResultSchema,
    type CallSnapshot,
} from "@launchstack/pipelines/call-notes";

import {
    CallNotesApplicationError,
    callNotesErrorResponse,
    getWebCallNotesApplication,
} from "~/server/call-notes/application";
import { processQueuedCallNotesEnrichment } from "~/server/call-notes/enrichment-runner";
import { assertCaptureDeviceCall } from "~/server/call-notes/capture-control";
import { requireCaptureDevice, type CaptureDeviceContext } from "~/server/call-notes/device-auth";
import { pollCaptureDevice } from "~/server/call-notes/capture-wake";
import { requestTranslator } from "~/i18n/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CallIdSchema = z.string().min(1).max(64);
const EventIdSchema = z.string().min(1).max(64);
const SourceKeySchema = z.string().min(1).max(256);
const TimestampSchema = z.string().datetime({ offset: true });

const LocalCaptureEventBaseSchema = z
    .object({
        schemaVersion: z.literal(CALL_NOTES_SCHEMA_VERSION),
        eventId: EventIdSchema,
        source: z.literal("local_audio"),
        sourceOccurrenceKey: SourceKeySchema,
        sourceAttemptKey: SourceKeySchema.optional(),
        occurredAt: TimestampSchema,
    })
    .strict();

const LocalCaptureEventSchema = z.discriminatedUnion("kind", [
    LocalCaptureEventBaseSchema.extend({
        kind: z.literal("attempt_connected"),
        sourceAttemptKey: SourceKeySchema,
        sourceStreamKey: SourceKeySchema,
    }).strict(),
    LocalCaptureEventBaseSchema.extend({
        kind: z.literal("transcript_segment"),
        sourceAttemptKey: SourceKeySchema,
        sourcePacketHash: z.string().regex(/^[a-f0-9]{64}$/),
        sourceKind: z.literal("derived_asr"),
        participant: z.literal(null),
        audioChannel: AudioChannelSchema,
        sourceStartMs: z.number().int().nonnegative().optional(),
        sourceEndMs: z.number().int().nonnegative().optional(),
        receivedAt: TimestampSchema,
        receiveOrder: z.number().int().nonnegative(),
        text: z.string().min(1).max(20_000),
        language: z.string().min(1).max(32).optional(),
    }).strict(),
    LocalCaptureEventBaseSchema.extend({
        kind: z.literal("attempt_ended"),
        sourceAttemptKey: SourceKeySchema,
        reason: z.enum(["silence_timeout", "user_stopped", "user_paused", "source_stopped"]),
    }).strict(),
    LocalCaptureEventBaseSchema.extend({
        kind: z.literal("attempt_failed"),
        sourceAttemptKey: SourceKeySchema,
        code: z.string().min(1).max(128),
        message: z.string().max(1024).optional(),
    }).strict(),
    LocalCaptureEventBaseSchema.extend({
        kind: z.literal("occurrence_ended"),
        reason: z.string().max(512).optional(),
    }).strict(),
]);

const LocalWorkerPollSchema = LocalCapturePollInputSchema.omit({
    companyId: true,
    userId: true,
    deviceId: true,
}).extend({
    kind: z.literal("poll"),
});

const LocalWorkerEventSchema = z
    .object({
        kind: z.literal("event"),
        callId: CallIdSchema,
        event: LocalCaptureEventSchema,
    })
    .strict();

const LocalWorkerFinishSchema = z
    .object({
        kind: z.literal("finish"),
        callId: CallIdSchema,
        autoEnrich: z.boolean(),
    })
    .strict();

const LocalWorkerRequestSchema = z.discriminatedUnion("kind", [
    LocalWorkerPollSchema,
    LocalWorkerEventSchema,
    LocalWorkerFinishSchema,
]);

function requestId(kind: string, context: CaptureDeviceContext, key: string): string {
    return createHash("sha256")
        .update(
            `${CALL_NOTES_SCHEMA_VERSION}\0${kind}\0${context.companyId}\0${context.userId}\0${key}`
        )
        .digest("hex");
}

function assertCallOwner(snapshot: CallSnapshot, userId: string): void {
    const noteOwner = snapshot.note?.ownerUserId;
    if (noteOwner !== null && noteOwner !== undefined && noteOwner !== userId) {
        throw new CallNotesApplicationError(
            "forbidden",
            "Only the Call Note owner may finish capture"
        );
    }

    const capabilities = snapshot.viewerCapabilities;
    if (
        capabilities &&
        typeof capabilities.canEditNote === "boolean" &&
        !capabilities.canEditNote
    ) {
        throw new CallNotesApplicationError(
            "forbidden",
            "Only the Call Note owner may finish capture"
        );
    }
}

export async function POST(request: Request): Promise<Response> {
    const auth = await requireCaptureDevice(request);
    if (!auth.success) return auth.response;
    const context = auth.data;
    const t = requestTranslator(request, "calls.server");

    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: t("invalidRequest") }, { status: 400 });
    }

    const parsed = LocalWorkerRequestSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ error: t("invalidRequest") }, { status: 400 });
    }

    try {
        const application = getWebCallNotesApplication();
        switch (parsed.data.kind) {
            case "poll": {
                const poll = parsed.data;
                const result = await pollCaptureDevice({
                    deviceId: context.deviceId,
                    wait: poll.wait === true && poll.activeAttemptKey === undefined,
                    signal: request.signal,
                    poll: () =>
                        application.pollLocalCapture({
                            companyId: context.companyId,
                            userId: context.userId,
                            deviceId: context.deviceId,
                            workerId: poll.workerId,
                            activeAttemptKey: poll.activeAttemptKey,
                        }),
                });
                return NextResponse.json(LocalCapturePollResultSchema.parse(result));
            }
            case "event": {
                await assertCaptureDeviceCall(context, parsed.data.callId);
                const snapshot = await application.getCall({
                    companyId: context.companyId,
                    actorUserId: context.userId,
                    callId: parsed.data.callId,
                });
                if (snapshot.viewerCapabilities.canControlCapture !== true) {
                    return NextResponse.json({ error: "forbidden" }, { status: 403 });
                }
                if (snapshot.sourceOccurrenceKey !== parsed.data.event.sourceOccurrenceKey) {
                    return NextResponse.json({ error: "forbidden" }, { status: 403 });
                }
                await application.ingestLocalCaptureEvent(context.companyId, parsed.data.event);
                return NextResponse.json({ ok: true });
            }
            case "finish": {
                await assertCaptureDeviceCall(context, parsed.data.callId);
                const initial = await application.getCall({
                    companyId: context.companyId,
                    actorUserId: context.userId,
                    callId: parsed.data.callId,
                });
                assertCallOwner(initial, context.userId);
                if (initial.status === "active" || initial.status === "finalizing") {
                    throw new CallNotesApplicationError(
                        "invalid_transition",
                        "Call capture must finalize before finish"
                    );
                }

                if (parsed.data.autoEnrich && initial.transcript.length > 0) {
                    await application.execute({
                        schemaVersion: CALL_NOTES_SCHEMA_VERSION,
                        requestId: requestId("enrichment", context, parsed.data.callId),
                        kind: "request_enrichment",
                        companyId: context.companyId,
                        actorUserId: context.userId,
                        callId: parsed.data.callId,
                    });
                    const callId = parsed.data.callId;
                    // Audio shutdown must not wait for the enrichment model.
                    // The queued run is durable before the worker receives its acknowledgment.
                    after(async () => {
                        await processQueuedCallNotesEnrichment(context.companyId, callId);
                    });
                }

                const snapshot = await application.getCall({
                    companyId: context.companyId,
                    actorUserId: context.userId,
                    callId: parsed.data.callId,
                });
                assertCallOwner(snapshot, context.userId);
                return NextResponse.json(snapshot);
            }
        }
    } catch (error) {
        return callNotesErrorResponse(error, request);
    }
}
