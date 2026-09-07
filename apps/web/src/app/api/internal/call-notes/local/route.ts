import { createHash, timingSafeEqual } from "node:crypto";

import { after, NextResponse } from "next/server";
import { z } from "zod";

import {
    AudioChannelSchema,
    CALL_NOTES_SCHEMA_VERSION,
    LocalCapturePollInputSchema,
    LocalCapturePollResultSchema,
    type CallSnapshot,
} from "@launchstack/pipelines/call-notes";

import { env } from "~/env";
import {
    CallNotesApplicationError,
    callNotesErrorResponse,
    getWebCallNotesApplication,
} from "~/server/call-notes/application";
import { processQueuedCallNotesEnrichment } from "~/server/call-notes/enrichment-runner";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CompanyIdSchema = z.string().regex(/^\d+$/);
const UserIdSchema = z.string().min(1).max(256);
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
        reason: z.enum(["silence_timeout", "user_stopped", "source_stopped"]),
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

type LocalCaptureEvent = z.infer<typeof LocalCaptureEventSchema>;

const LocalWorkerPollSchema = LocalCapturePollInputSchema.extend({
    kind: z.literal("poll"),
});

const LocalWorkerEventSchema = z
    .object({
        kind: z.literal("event"),
        companyId: CompanyIdSchema,
        userId: UserIdSchema,
        callId: CallIdSchema,
        event: LocalCaptureEventSchema,
    })
    .strict();

const LocalWorkerFinishSchema = z
    .object({
        kind: z.literal("finish"),
        companyId: CompanyIdSchema,
        userId: UserIdSchema,
        callId: CallIdSchema,
        autoEnrich: z.boolean(),
    })
    .strict();

const LocalWorkerRequestSchema = z.discriminatedUnion("kind", [
    LocalWorkerPollSchema,
    LocalWorkerEventSchema,
    LocalWorkerFinishSchema,
]);
type LocalWorkerRequest = z.infer<typeof LocalWorkerRequestSchema>;
type LocalWorkerContext = { companyId: string; userId: string };

function unauthorized(): NextResponse {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function forbidden(): NextResponse {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

function unavailable(): NextResponse {
    return NextResponse.json({ error: "Call Notes is unavailable" }, { status: 503 });
}

function constantTimeTokenMatches(expected: string | undefined, supplied: string | null): boolean {
    const expectedDigest = createHash("sha256")
        .update(expected ?? "")
        .digest();
    const suppliedDigest = createHash("sha256")
        .update(supplied ?? "")
        .digest();
    return Boolean(expected) && timingSafeEqual(expectedDigest, suppliedDigest);
}

function hasValidBearerToken(request: Request): boolean {
    const header = request.headers.get("authorization");
    const match = header?.match(/^Bearer ([^\s]+)$/);
    return constantTimeTokenMatches(env.server.CALL_NOTES_INTERNAL_TOKEN, match?.[1] ?? null);
}

function configuredContext(): LocalWorkerContext | null {
    const companyId = env.server.CALL_NOTES_LOCAL_COMPANY_ID;
    const userId = env.server.CALL_NOTES_LOCAL_USER_ID;
    if (!companyId || !/^\d+$/.test(companyId) || !userId) return null;
    return { companyId, userId };
}

function requestId(kind: string, context: LocalWorkerContext, key: string): string {
    return createHash("sha256")
        .update(
            `${CALL_NOTES_SCHEMA_VERSION}\0${kind}\0${context.companyId}\0${context.userId}\0${key}`
        )
        .digest("hex");
}

function requestMatchesContext(
    request: LocalWorkerRequest,
    context: LocalWorkerContext
): request is LocalWorkerRequest & { companyId: string } {
    return request.companyId === context.companyId && request.userId === context.userId;
}

function hasStrictCaptureEventShape(raw: unknown, parsed: LocalCaptureEvent): boolean {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return false;
    const rawEvent = raw as Record<string, unknown>;
    const parsedEvent = parsed as unknown as Record<string, unknown>;
    const rawKeys = Object.keys(rawEvent);
    const parsedKeys = Object.keys(parsedEvent);
    if (rawKeys.length !== parsedKeys.length || rawKeys.some(key => !parsedKeys.includes(key))) {
        return false;
    }

    if (!("participant" in rawEvent) || rawEvent.participant === null) return true;
    if (
        !("participant" in parsed) ||
        parsed.participant === null ||
        typeof rawEvent.participant !== "object" ||
        rawEvent.participant === null ||
        Array.isArray(rawEvent.participant)
    ) {
        return false;
    }
    const rawParticipant = rawEvent.participant as Record<string, unknown>;
    const parsedParticipant = parsed.participant as Record<string, unknown>;
    const rawParticipantKeys = Object.keys(rawParticipant);
    const parsedParticipantKeys = Object.keys(parsedParticipant);
    return (
        rawParticipantKeys.length === parsedParticipantKeys.length &&
        rawParticipantKeys.every(key => parsedParticipantKeys.includes(key))
    );
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
    if (!hasValidBearerToken(request)) return unauthorized();
    if (!env.server.CALL_NOTES_CAPTURE_ENABLED) return unavailable();

    const context = configuredContext();
    if (!context) return unavailable();

    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: "Invalid Call Notes request" }, { status: 400 });
    }

    const parsed = LocalWorkerRequestSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ error: "Invalid Call Notes request" }, { status: 400 });
    }
    if (parsed.data.kind === "event") {
        const rawEvent =
            body !== null && typeof body === "object" && !Array.isArray(body)
                ? (body as Record<string, unknown>).event
                : undefined;
        if (!hasStrictCaptureEventShape(rawEvent, parsed.data.event)) {
            return NextResponse.json({ error: "Invalid Call Notes request" }, { status: 400 });
        }
    }
    if (!requestMatchesContext(parsed.data, context)) return forbidden();

    try {
        const application = getWebCallNotesApplication();
        switch (parsed.data.kind) {
            case "poll": {
                const result = await application.pollLocalCapture({
                    companyId: context.companyId,
                    userId: context.userId,
                    workerId: parsed.data.workerId,
                });
                return NextResponse.json(LocalCapturePollResultSchema.parse(result));
            }
            case "event": {
                const snapshot = await application.getCall({
                    companyId: context.companyId,
                    actorUserId: context.userId,
                    callId: parsed.data.callId,
                });
                if (snapshot.viewerCapabilities.canControlCapture !== true) {
                    return forbidden();
                }
                if (snapshot.sourceOccurrenceKey !== parsed.data.event.sourceOccurrenceKey) {
                    return forbidden();
                }
                await application.ingestLocalCaptureEvent(context.companyId, parsed.data.event);
                return NextResponse.json({ ok: true });
            }
            case "finish": {
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
        return callNotesErrorResponse(error);
    }
}
