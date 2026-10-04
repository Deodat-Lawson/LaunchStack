import type * as NextServerModule from "next/server";
import type * as CallNotesApplicationModule from "~/server/call-notes/application";
import {
    CALL_NOTES_SCHEMA_VERSION,
    CallNotesApplicationError,
    type CallSnapshot,
    type CaptureEvent,
} from "@launchstack/pipelines/call-notes";

const mockGetApplication = jest.fn();
const mockExecute = jest.fn();
const mockPollLocalCapture = jest.fn();
const mockIngestLocalCaptureEvent = jest.fn();
const mockGetCall = jest.fn();
const mockIngestCaptureEvent = mockIngestLocalCaptureEvent;
const mockProcessQueuedEnrichment = jest.fn();
const mockAfterTasks: Array<() => Promise<void>> = [];
jest.mock("next/server", () => ({
    ...jest.requireActual<typeof NextServerModule>("next/server"),
    after: (task: () => Promise<void>) => {
        mockAfterTasks.push(task);
    },
}));

const DEFAULT_SERVER_ENV = {
    CALL_NOTES_CAPTURE_ENABLED: true,
    CALL_NOTES_INTERNAL_TOKEN: "local-worker-secret",
    CALL_NOTES_LOCAL_COMPANY_ID: "42",
    CALL_NOTES_LOCAL_USER_ID: "local-capture-user",
} as const;

const mockServerEnv: Record<string, unknown> = { ...DEFAULT_SERVER_ENV };

jest.mock("~/env", () => ({
    get env() {
        return { server: mockServerEnv };
    },
}));

jest.mock("~/server/engine", () => ({ getEngine: jest.fn() }));

jest.mock("~/server/call-notes/application", () => {
    const actual = jest.requireActual<typeof CallNotesApplicationModule>(
        "~/server/call-notes/application"
    );
    return {
        ...actual,
        getWebCallNotesApplication: (...args: unknown[]): unknown => mockGetApplication(...args),
    };
});

jest.mock("~/server/call-notes/enrichment-runner", () => ({
    processQueuedCallNotesEnrichment: (...args: unknown[]): unknown =>
        mockProcessQueuedEnrichment(...args),
}));

import { POST as ingestLocalCallNotes } from "~/app/api/internal/call-notes/local/route";

const AUTHORIZATION = `Bearer ${DEFAULT_SERVER_ENV.CALL_NOTES_INTERNAL_TOKEN}`;
const LOCAL_COMPANY_ID = DEFAULT_SERVER_ENV.CALL_NOTES_LOCAL_COMPANY_ID;
const LOCAL_USER_ID = DEFAULT_SERVER_ENV.CALL_NOTES_LOCAL_USER_ID;

const START_BODY = {
    kind: "start",
    companyId: LOCAL_COMPANY_ID,
    userId: LOCAL_USER_ID,
    occurrenceKey: "local-occurrence-1",
    attemptKey: "local-attempt-1",
    startedAt: "2026-08-15T14:00:00.000Z",
    title: "Local audio capture",
} as const;

const POLL_BODY = {
    kind: "poll",
    companyId: LOCAL_COMPANY_ID,
    userId: LOCAL_USER_ID,
    workerId: START_BODY.attemptKey,
} as const;

const CAPTURE_EVENT: CaptureEvent = {
    schemaVersion: CALL_NOTES_SCHEMA_VERSION,
    eventId: "event-segment-1",
    kind: "transcript_segment",
    source: "local_audio",
    sourceOccurrenceKey: START_BODY.occurrenceKey,
    sourceAttemptKey: START_BODY.attemptKey,
    sourcePacketHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    sourceKind: "derived_asr",
    audioChannel: "system",
    participant: null,
    sourceStartMs: 1_000,
    sourceEndMs: 4_000,
    receivedAt: "2026-08-15T14:00:04.100Z",
    receiveOrder: 1,
    text: "We need to reduce onboarding time before the September launch.",
    language: "en",
    occurredAt: "2026-08-15T14:00:04.100Z",
};
const MICROPHONE_CAPTURE_EVENT: CaptureEvent = {
    ...CAPTURE_EVENT,
    eventId: "event-segment-microphone",
    sourcePacketHash: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    audioChannel: "microphone",
    receiveOrder: 2,
    text: "I will send the revised onboarding checklist by Friday.",
};
const ATTRIBUTED_TRANSCRIPT_EVENT = {
    ...CAPTURE_EVENT,
    eventId: "event-attributed-transcript",
    participant: {
        sourceParticipantKey: "remote-speaker",
        displayName: "Remote Speaker",
    },
} as const;

const PARTICIPANT_EVENT: CaptureEvent = {
    schemaVersion: CALL_NOTES_SCHEMA_VERSION,
    eventId: "event-participant-joined",
    kind: "participant_joined",
    source: "local_audio",
    sourceOccurrenceKey: START_BODY.occurrenceKey,
    sourceAttemptKey: START_BODY.attemptKey,
    participant: {
        sourceParticipantKey: "remote-speaker",
        displayName: "Remote Speaker",
    },
    occurredAt: "2026-08-15T14:00:00.100Z",
};

const TRANSPORT_EVENT: CaptureEvent = {
    schemaVersion: CALL_NOTES_SCHEMA_VERSION,
    eventId: "event-transport-interrupted",
    kind: "transport_interrupted",
    source: "local_audio",
    sourceOccurrenceKey: START_BODY.occurrenceKey,
    sourceAttemptKey: START_BODY.attemptKey,
    reason: "network interruption",
    occurredAt: "2026-08-15T14:00:00.200Z",
};

const ATTEMPT_CONNECTED_EVENT: CaptureEvent = {
    schemaVersion: CALL_NOTES_SCHEMA_VERSION,
    eventId: "event-attempt-connected",
    kind: "attempt_connected",
    source: "local_audio",
    sourceOccurrenceKey: START_BODY.occurrenceKey,
    sourceAttemptKey: START_BODY.attemptKey,
    sourceStreamKey: "local-stream-1",
    occurredAt: "2026-08-15T14:00:00.300Z",
};

const ATTEMPT_ENDED_EVENT: CaptureEvent = {
    schemaVersion: CALL_NOTES_SCHEMA_VERSION,
    eventId: "event-attempt-ended",
    kind: "attempt_ended",
    source: "local_audio",
    sourceOccurrenceKey: START_BODY.occurrenceKey,
    sourceAttemptKey: START_BODY.attemptKey,
    reason: "user_stopped",
    occurredAt: "2026-08-15T14:00:00.400Z",
};

const ATTEMPT_FAILED_EVENT: CaptureEvent = {
    schemaVersion: CALL_NOTES_SCHEMA_VERSION,
    eventId: "event-attempt-failed",
    kind: "attempt_failed",
    source: "local_audio",
    sourceOccurrenceKey: START_BODY.occurrenceKey,
    sourceAttemptKey: START_BODY.attemptKey,
    code: "microphone_unavailable",
    message: "Microphone unavailable",
    occurredAt: "2026-08-15T14:00:00.500Z",
};

const OCCURRENCE_ENDED_EVENT: CaptureEvent = {
    schemaVersion: CALL_NOTES_SCHEMA_VERSION,
    eventId: "event-occurrence-ended",
    kind: "occurrence_ended",
    source: "local_audio",
    sourceOccurrenceKey: START_BODY.occurrenceKey,
    occurredAt: "2026-08-15T14:00:00.600Z",
};

const ALLOWED_LOCAL_EVENTS: readonly CaptureEvent[] = [
    ATTEMPT_CONNECTED_EVENT,
    ATTEMPT_ENDED_EVENT,
    ATTEMPT_FAILED_EVENT,
    OCCURRENCE_ENDED_EVENT,
];

const DISALLOWED_LOCAL_EVENTS: readonly unknown[] = [
    ATTRIBUTED_TRANSCRIPT_EVENT,
    PARTICIPANT_EVENT,
    TRANSPORT_EVENT,
];

const eventBody = (event: unknown, overrides: Record<string, unknown> = {}) => ({
    kind: "event" as const,
    companyId: LOCAL_COMPANY_ID,
    userId: LOCAL_USER_ID,
    callId: "call-1",
    event,
    ...overrides,
});

const EVENT_BODY = eventBody(CAPTURE_EVENT);

const FINISH_BODY = {
    kind: "finish",
    companyId: LOCAL_COMPANY_ID,
    userId: LOCAL_USER_ID,
    callId: "call-1",
    autoEnrich: false,
} as const;
const APPLICATION = {
    execute: mockExecute,
    pollLocalCapture: mockPollLocalCapture,
    ingestCaptureEvent: mockIngestCaptureEvent,
    ingestLocalCaptureEvent: mockIngestLocalCaptureEvent,
    getCall: mockGetCall,
};

function ownedSnapshot(overrides: Record<string, unknown> = {}): CallSnapshot {
    return {
        id: "call-1",
        companyId: LOCAL_COMPANY_ID,
        source: "local_audio",
        sourceOccurrenceKey: START_BODY.occurrenceKey,
        note: { ownerUserId: LOCAL_USER_ID },
        viewerCapabilities: { canEditNote: true, canControlCapture: true },
        ...overrides,
    } as unknown as CallSnapshot;
}

function resetServerEnv(): void {
    for (const key of Object.keys(mockServerEnv)) delete mockServerEnv[key];
    Object.assign(mockServerEnv, DEFAULT_SERVER_ENV);
}

function request(body: unknown, authorization: string | null = AUTHORIZATION): Request {
    const headers = new Headers({ "content-type": "application/json" });
    if (authorization !== null) headers.set("authorization", authorization);

    const init: RequestInit = { method: "POST", headers };
    if (body !== undefined) {
        init.body = typeof body === "string" ? body : JSON.stringify(body);
    }
    return new Request("http://localhost/api/internal/call-notes/local", init);
}

async function responseBody(response: Response): Promise<unknown> {
    return response.json();
}

beforeEach(() => {
    jest.resetAllMocks();
    mockAfterTasks.length = 0;
    resetServerEnv();
    mockGetApplication.mockReturnValue(APPLICATION);
    mockExecute.mockResolvedValue(null);
    mockPollLocalCapture.mockResolvedValue({ capture: null });
    mockIngestLocalCaptureEvent.mockResolvedValue(undefined);
    mockGetCall.mockResolvedValue(ownedSnapshot());
    mockProcessQueuedEnrichment.mockResolvedValue(false);
});

describe("local Call Notes worker ingress", () => {
    it.each([
        ["missing", null],
        ["malformed", "Bearer"],
        ["wrong", "Bearer another-secret"],
    ])(
        "rejects a %s Bearer token before touching the application",
        async (_label, authorization) => {
            const response = await ingestLocalCallNotes(request(POLL_BODY, authorization));

            expect(response.status).toBe(401);
            expect(await responseBody(response)).toEqual({ error: "Unauthorized" });
            expect(mockGetApplication).not.toHaveBeenCalled();
            expect(mockExecute).not.toHaveBeenCalled();
        }
    );

    it("fails closed when local capture is disabled before parsing or touching production boundaries", async () => {
        mockServerEnv.CALL_NOTES_CAPTURE_ENABLED = false;

        const response = await ingestLocalCallNotes(request("not-json"));

        expect(response.status).toBe(503);
        expect(await responseBody(response)).toEqual({ error: "Call Notes is unavailable" });
        expect(mockGetApplication).not.toHaveBeenCalled();
        expect(mockExecute).not.toHaveBeenCalled();
    });

    it.each([
        ["missing company context", { CALL_NOTES_LOCAL_COMPANY_ID: undefined }],
        ["malformed company context", { CALL_NOTES_LOCAL_COMPANY_ID: "not-a-company" }],
        ["missing user context", { CALL_NOTES_LOCAL_USER_ID: undefined }],
    ])("returns unavailable for %s", async (_label, overrides) => {
        Object.assign(mockServerEnv, overrides);

        const response = await ingestLocalCallNotes(request(POLL_BODY));

        expect(response.status).toBe(503);
        expect(await responseBody(response)).toEqual({ error: "Call Notes is unavailable" });
        expect(mockGetApplication).not.toHaveBeenCalled();
        expect(mockExecute).not.toHaveBeenCalled();
    });

    it.each([
        ["poll", { ...POLL_BODY, unexpected: true }],
        ["event envelope", { ...EVENT_BODY, unexpected: true }],
        ["event payload", { ...EVENT_BODY, event: { ...CAPTURE_EVENT, unexpected: true } }],
        ["finish", { ...FINISH_BODY, unexpected: true }],
    ])("rejects unknown keys in the %s body", async (_label, body) => {
        const response = await ingestLocalCallNotes(request(body));

        expect(response.status).toBe(400);
        expect(await responseBody(response)).toEqual({ error: "Invalid Call Notes request" });
        expect(mockGetApplication).not.toHaveBeenCalled();
    });

    it.each([
        ["poll company", { ...POLL_BODY, companyId: "99" }],
        ["poll user", { ...POLL_BODY, userId: "attacker" }],
        ["event company", { ...EVENT_BODY, companyId: "99" }],
        ["event user", { ...EVENT_BODY, userId: "attacker" }],
        ["finish company", { ...FINISH_BODY, companyId: "99" }],
        ["finish user", { ...FINISH_BODY, userId: "attacker" }],
    ])("rejects %s scope mismatch", async (_label, body) => {
        const response = await ingestLocalCallNotes(request(body));

        expect(response.status).toBe(403);
        expect(await responseBody(response)).toEqual({ error: "Forbidden" });
        expect(mockGetApplication).not.toHaveBeenCalled();
    });

    it("rejects a non-local capture event before ingestion", async () => {
        const response = await ingestLocalCallNotes(
            request({
                ...EVENT_BODY,
                event: { ...CAPTURE_EVENT, source: "remote_conference" },
            })
        );

        expect(response.status).toBe(400);
        expect(await responseBody(response)).toEqual({ error: "Invalid Call Notes request" });
        expect(mockGetApplication).not.toHaveBeenCalled();
        expect(mockIngestCaptureEvent).not.toHaveBeenCalled();
    });

    it("polls an assigned session and preserves the worker identity in the request", async () => {
        const result = {
            capture: {
                callId: "call-1",
                captureId: "capture-1",
                occurrenceKey: START_BODY.occurrenceKey,
                attemptKey: START_BODY.attemptKey,
                startedAt: START_BODY.startedAt,
                title: START_BODY.title,
                desiredMode: "running",
            },
        } as const;
        mockPollLocalCapture.mockResolvedValue(result);

        const response = await ingestLocalCallNotes(request(POLL_BODY));

        expect(response.status).toBe(200);
        expect(await responseBody(response)).toEqual(result);
        expect(mockPollLocalCapture).toHaveBeenCalledTimes(1);
        expect(mockPollLocalCapture).toHaveBeenCalledWith({
            companyId: LOCAL_COMPANY_ID,
            userId: LOCAL_USER_ID,
            workerId: POLL_BODY.workerId,
        });
        expect(mockExecute).not.toHaveBeenCalled();
    });

    it.each([
        ["system", CAPTURE_EVENT],
        ["microphone", MICROPHONE_CAPTURE_EVENT],
    ])(
        "ingests a valid null-participant %s transcript after checking call control",
        async (_channel, event) => {
            const response = await ingestLocalCallNotes(request(eventBody(event)));

            expect(response.status).toBe(200);
            expect(await responseBody(response)).toEqual({ ok: true });
            expect(mockGetCall).toHaveBeenCalledTimes(1);
            expect(mockGetCall).toHaveBeenCalledWith({
                companyId: LOCAL_COMPANY_ID,
                actorUserId: LOCAL_USER_ID,
                callId: EVENT_BODY.callId,
            });
            expect(mockIngestCaptureEvent).toHaveBeenCalledTimes(1);
            expect(mockIngestCaptureEvent).toHaveBeenCalledWith(LOCAL_COMPANY_ID, event);
            const getCallOrder = mockGetCall.mock.invocationCallOrder[0];
            const ingestCaptureOrder = mockIngestCaptureEvent.mock.invocationCallOrder[0];
            expect(getCallOrder).toBeDefined();
            expect(ingestCaptureOrder).toBeDefined();
            expect(getCallOrder!).toBeLessThan(ingestCaptureOrder!);
            expect(mockExecute).not.toHaveBeenCalled();
        }
    );

    it.each([
        ["missing", { ...CAPTURE_EVENT, audioChannel: undefined }],
        ["unknown", { ...CAPTURE_EVENT, audioChannel: "application" }],
    ])("rejects a transcript with a %s audio channel", async (_label, event) => {
        const response = await ingestLocalCallNotes(request(eventBody(event)));

        expect(response.status).toBe(400);
        expect(await responseBody(response)).toEqual({ error: "Invalid Call Notes request" });
        expect(mockGetCall).not.toHaveBeenCalled();
        expect(mockIngestCaptureEvent).not.toHaveBeenCalled();
    });

    it.each(ALLOWED_LOCAL_EVENTS)("ingests allowed local pipeline event %#", async event => {
        const response = await ingestLocalCallNotes(request(eventBody(event)));

        expect(response.status).toBe(200);
        expect(await responseBody(response)).toEqual({ ok: true });
        expect(mockGetCall).toHaveBeenCalledWith({
            companyId: LOCAL_COMPANY_ID,
            actorUserId: LOCAL_USER_ID,
            callId: "call-1",
        });
        expect(mockIngestCaptureEvent).toHaveBeenCalledWith(LOCAL_COMPANY_ID, event);
        const getCallOrder = mockGetCall.mock.invocationCallOrder[0];
        const ingestCaptureOrder = mockIngestCaptureEvent.mock.invocationCallOrder[0];
        expect(getCallOrder).toBeDefined();
        expect(ingestCaptureOrder).toBeDefined();
        expect(getCallOrder!).toBeLessThan(ingestCaptureOrder!);
    });

    it.each(DISALLOWED_LOCAL_EVENTS)(
        "rejects attributed, participant, and transport events %#",
        async event => {
            const response = await ingestLocalCallNotes(request(eventBody(event)));

            expect(response.status).toBe(400);
            expect(await responseBody(response)).toEqual({
                error: "Invalid Call Notes request",
            });
            expect(mockGetCall).not.toHaveBeenCalled();
            expect(mockIngestCaptureEvent).not.toHaveBeenCalled();
        }
    );

    it("rejects an event whose occurrence belongs to another call", async () => {
        mockGetCall.mockResolvedValue(
            ownedSnapshot({
                id: "call-2",
                sourceOccurrenceKey: "local-occurrence-2",
            })
        );

        const response = await ingestLocalCallNotes(
            request(eventBody(CAPTURE_EVENT, { callId: "call-2" }))
        );

        expect(response.status).toBe(403);
        expect(await responseBody(response)).toEqual({ error: "Forbidden" });
        expect(mockGetCall).toHaveBeenCalledWith({
            companyId: LOCAL_COMPANY_ID,
            actorUserId: LOCAL_USER_ID,
            callId: "call-2",
        });
        expect(mockIngestCaptureEvent).not.toHaveBeenCalled();
    });

    it("rejects an event whose attempt is not owned by the claimed local session", async () => {
        mockIngestLocalCaptureEvent.mockRejectedValue(
            new CallNotesApplicationError(
                "forbidden",
                "Capture event does not belong to the claimed worker attempt"
            )
        );

        const response = await ingestLocalCallNotes(request(EVENT_BODY));

        expect(response.status).toBe(403);
        expect(await responseBody(response)).toEqual({
            error: "Capture event does not belong to the claimed worker attempt",
            code: "forbidden",
        });
        expect(mockGetCall).toHaveBeenCalledTimes(1);
        expect(mockIngestLocalCaptureEvent).toHaveBeenCalledWith(LOCAL_COMPANY_ID, CAPTURE_EVENT);
    });

    it("rejects a call whose viewer cannot control capture", async () => {
        mockGetCall.mockResolvedValue(
            ownedSnapshot({
                viewerCapabilities: { canEditNote: true, canControlCapture: false },
            })
        );

        const response = await ingestLocalCallNotes(request(EVENT_BODY));

        expect(response.status).toBe(403);
        expect(await responseBody(response)).toEqual({ error: "Forbidden" });
        expect(mockGetCall).toHaveBeenCalledTimes(1);
        expect(mockIngestCaptureEvent).not.toHaveBeenCalled();
    });

    it("rejects a mismatched event user and call before loading a call", async () => {
        const response = await ingestLocalCallNotes(
            request(eventBody(CAPTURE_EVENT, { userId: "attacker", callId: "call-2" }))
        );

        expect(response.status).toBe(403);
        expect(await responseBody(response)).toEqual({ error: "Forbidden" });
        expect(mockGetCall).not.toHaveBeenCalled();
        expect(mockIngestCaptureEvent).not.toHaveBeenCalled();
    });
    it("checks the Call Note owner before finishing", async () => {
        mockGetCall.mockResolvedValue(ownedSnapshot({ note: { ownerUserId: "different-user" } }));

        const response = await ingestLocalCallNotes(request(FINISH_BODY));

        expect(response.status).toBe(403);
        expect(await responseBody(response)).toEqual({
            error: "Only the Call Note owner may finish capture",
            code: "forbidden",
        });
        expect(mockGetCall).toHaveBeenCalledTimes(1);
        expect(mockGetCall).toHaveBeenCalledWith({
            companyId: LOCAL_COMPANY_ID,
            actorUserId: LOCAL_USER_ID,
            callId: FINISH_BODY.callId,
        });
        expect(mockExecute).not.toHaveBeenCalled();
        expect(mockProcessQueuedEnrichment).not.toHaveBeenCalled();
    });

    it("finishes without requesting enrichment and returns the current snapshot", async () => {
        const snapshot = ownedSnapshot();
        mockGetCall.mockResolvedValue(snapshot);

        const response = await ingestLocalCallNotes(request(FINISH_BODY));

        expect(response.status).toBe(200);
        expect(await responseBody(response)).toEqual(snapshot);
        expect(mockGetCall).toHaveBeenCalledTimes(2);
        expect(mockGetCall).toHaveBeenNthCalledWith(1, {
            companyId: LOCAL_COMPANY_ID,
            actorUserId: LOCAL_USER_ID,
            callId: FINISH_BODY.callId,
        });
        expect(mockGetCall).toHaveBeenNthCalledWith(2, {
            companyId: LOCAL_COMPANY_ID,
            actorUserId: LOCAL_USER_ID,
            callId: FINISH_BODY.callId,
        });
        expect(mockExecute).not.toHaveBeenCalled();
        expect(mockProcessQueuedEnrichment).not.toHaveBeenCalled();
    });

    it("finishes successfully without enriching an empty transcript", async () => {
        const snapshot = ownedSnapshot({ transcript: [] });
        mockGetCall.mockResolvedValue(snapshot);

        const response = await ingestLocalCallNotes(request({ ...FINISH_BODY, autoEnrich: true }));

        expect(response.status).toBe(200);
        expect(await responseBody(response)).toEqual(snapshot);
        expect(mockExecute).not.toHaveBeenCalled();
        expect(mockProcessQueuedEnrichment).not.toHaveBeenCalled();
    });

    it("acknowledges capture finish before the enrichment model runs", async () => {
        const initialSnapshot = ownedSnapshot({ transcript: [{ id: "segment-1" }] });
        const queuedSnapshot = ownedSnapshot({
            enrichment: { status: "queued", proposal: null },
        });
        let currentSnapshot = initialSnapshot;
        mockGetCall.mockImplementation(async () => currentSnapshot);
        mockExecute.mockImplementation(async () => {
            currentSnapshot = queuedSnapshot;
            return queuedSnapshot;
        });

        const response = await ingestLocalCallNotes(request({ ...FINISH_BODY, autoEnrich: true }));

        expect(response.status).toBe(200);
        expect(await responseBody(response)).toEqual(queuedSnapshot);
        expect(mockProcessQueuedEnrichment).not.toHaveBeenCalled();
        await Promise.all(mockAfterTasks.map(task => task()));
        expect(mockProcessQueuedEnrichment).toHaveBeenCalledWith(
            LOCAL_COMPANY_ID,
            FINISH_BODY.callId
        );
    });
});
