import type * as ApplicationModule from "~/server/call-notes/application";
import {
    CALL_NOTES_SCHEMA_VERSION,
    type LocalCapturePollResult,
} from "@launchstack/pipelines/call-notes";

const mockAuthenticate = jest.fn();
const mockExecute = jest.fn();
const mockPoll = jest.fn();
const mockGetEngine = jest.fn();
const mockTranscribe = jest.fn();
const mockProvider = jest.fn();

jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("~/env", () => ({ env: { server: { CALL_NOTES_CAPTURE_ENABLED: true } } }));
jest.mock("~/server/engine", () => ({ getEngine: () => mockGetEngine() }));
jest.mock("~/server/call-notes/device-auth", () => ({
    requireCaptureDevice: (request: Request) => mockAuthenticate(request),
}));
jest.mock("~/server/call-notes/application", () => ({
    ...jest.requireActual<typeof ApplicationModule>("~/server/call-notes/application"),
    getWebCallNotesApplication: () => ({ execute: mockExecute, pollLocalCapture: mockPoll }),
}));
jest.mock("~/server/call-notes/enrichment-runner", () => ({
    processQueuedCallNotesEnrichment: jest.fn(),
}));
jest.mock("~/lib/require-workspace-context", () => ({
    requireWorkspacePermission: async () => ({
        success: true,
        data: { authUserId: "device-user", companyId: 42n },
    }),
}));
jest.mock("@launchstack/conversion/audio-transcription", () => ({
    getTranscriptionProvider: () => mockProvider(),
    isTranscriptionError: () => false,
}));

import { POST as command } from "~/app/api/call-notes/devices/commands/route";
import { POST as transcribe } from "~/app/api/call-notes/devices/transcribe/route";
import { POST as poll } from "~/app/api/internal/call-notes/local/route";
import { POST as sessionCommand } from "~/app/api/call-notes/route";

const DEVICE = { companyId: "42", userId: "device-user", deviceId: "device-mac" };
const SESSION = {
    callId: "call-1",
    captureId: "capture-1",
    occurrenceKey: "capture-occurrence",
    attemptKey: "worker:attempt",
    startedAt: "2026-10-25T05:00:00.000Z",
    title: "Local audio call",
    desiredMode: "running",
} as const;

function jsonRequest(body: unknown): Request {
    return new Request("http://localhost/api/call-notes/devices/commands", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    });
}

function audioRequest(bytes = 100, extra: Record<string, string> = {}): Request {
    const form = new FormData();
    form.set("audio", new Blob([new Uint8Array(bytes)], { type: "audio/wav" }), "utterance.wav");
    form.set("channel", "microphone");
    form.set("language", "en");
    return new Request("http://localhost/api/call-notes/devices/transcribe", {
        method: "POST",
        headers: extra,
        body: form,
    });
}

beforeEach(() => {
    jest.resetAllMocks();
    mockAuthenticate.mockResolvedValue({ success: true, data: DEVICE });
    mockExecute.mockResolvedValue({ id: SESSION.callId, status: "active" });
    mockPoll.mockResolvedValue({ capture: null });
    const query = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([{ deviceId: DEVICE.deviceId, userId: DEVICE.userId }]),
    };
    mockGetEngine.mockReturnValue({ db: { select: () => query } });
    mockProvider.mockResolvedValue({ transcribe: mockTranscribe });
    mockTranscribe.mockResolvedValue({
        data: { text: "We will follow up tomorrow.", language: "en" },
    });
});

describe("Capture device command routes", () => {
    it("starts as the authenticated device user and targets that device", async () => {
        const response = await command(jsonRequest({ kind: "start_capture" }));
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ id: SESSION.callId });
        expect(mockExecute).toHaveBeenCalledWith(
            expect.objectContaining({
                kind: "start_capture",
                actorUserId: DEVICE.userId,
                companyId: DEVICE.companyId,
                targetDeviceId: DEVICE.deviceId,
                source: "local_audio",
                title: "Local audio call",
            })
        );
    });

    it.each(["stop_capture", "pause_capture", "resume_capture"])(
        "runs %s as the device user",
        async kind => {
            const response = await command(jsonRequest({ kind, callId: SESSION.callId }));
            expect(response.status).toBe(200);
            expect(mockExecute).toHaveBeenCalledWith(
                expect.objectContaining({
                    kind,
                    callId: SESSION.callId,
                    actorUserId: DEVICE.userId,
                    companyId: DEVICE.companyId,
                    ...(kind === "resume_capture" ? { targetDeviceId: DEVICE.deviceId } : {}),
                })
            );
        }
    );

    it("cannot spoof another actor or device", async () => {
        expect(
            (
                await command(
                    jsonRequest({
                        kind: "start_capture",
                        actorUserId: "other",
                        targetDeviceId: "other",
                    })
                )
            ).status
        ).toBe(400);
        expect(mockExecute).not.toHaveBeenCalled();
    });

    it("does not stop another device's capture", async () => {
        const query = {
            from: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            limit: jest
                .fn()
                .mockResolvedValue([{ userId: DEVICE.userId, deviceId: "other-device" }]),
        };
        mockGetEngine.mockReturnValue({ db: { select: () => query } });
        expect(
            (await command(jsonRequest({ kind: "stop_capture", callId: SESSION.callId }))).status
        ).toBe(403);
        expect(mockExecute).not.toHaveBeenCalled();
    });

    it("preserves the auth helper's upgrade response", async () => {
        mockAuthenticate.mockResolvedValue({
            success: false,
            response: Response.json(
                { error: "upgrade_required", minVersion: "2.0.0" },
                { status: 426 }
            ),
        });
        expect((await command(jsonRequest({ kind: "start_capture" }))).status).toBe(426);
        expect(mockExecute).not.toHaveBeenCalled();
    });
});

describe("Capture device long polling", () => {
    it.each(["device", "session"])(
        "returns immediately when a %s start assigns a capture",
        async source => {
            jest.useFakeTimers();
            try {
                let assigned: LocalCapturePollResult["capture"] = null;
                mockPoll.mockImplementation(async () => ({ capture: assigned }));
                const pending = poll(jsonRequest({ kind: "poll", workerId: "worker", wait: true }));
                await jest.advanceTimersByTimeAsync(0);
                expect(mockPoll).toHaveBeenCalledTimes(1);
                mockExecute.mockImplementation(async () => {
                    assigned = SESSION;
                    return { id: SESSION.callId, status: "active" };
                });
                const response =
                    source === "device"
                        ? await command(jsonRequest({ kind: "start_capture" }))
                        : await sessionCommand(
                              jsonRequest({
                                  kind: "start_capture",
                                  schemaVersion: CALL_NOTES_SCHEMA_VERSION,
                                  requestId: "wake-start",
                                  sourceOccurrenceKey: SESSION.occurrenceKey,
                              })
                          );
                expect(response.status).toBe(200);
                expect(await (await pending).json()).toEqual({ capture: SESSION });
                expect(mockPoll).toHaveBeenCalledTimes(2);
                expect(mockPoll).toHaveBeenLastCalledWith(expect.objectContaining(DEVICE));
            } finally {
                jest.useRealTimers();
            }
        }
    );

    it("rechecks the database every five seconds and ends by twenty-five seconds", async () => {
        jest.useFakeTimers();
        try {
            const pending = poll(jsonRequest({ kind: "poll", workerId: "worker", wait: true }));
            await jest.advanceTimersByTimeAsync(5_000);
            expect(mockPoll).toHaveBeenCalledTimes(2);
            await jest.advanceTimersByTimeAsync(20_000);
            expect(await (await pending).json()).toEqual({ capture: null });
            expect(mockPoll).toHaveBeenCalledTimes(6);
            expect(jest.getTimerCount()).toBe(0);
        } finally {
            jest.useRealTimers();
        }
    });

    it("never holds an active worker poll", async () => {
        const response = await poll(
            jsonRequest({
                kind: "poll",
                workerId: "worker",
                activeAttemptKey: SESSION.attemptKey,
                wait: true,
            })
        );
        expect(response.status).toBe(200);
        expect(mockPoll).toHaveBeenCalledTimes(1);
    });
});

describe("Capture transcription", () => {
    it("bootstraps the configured provider and sends in-memory WAV bytes", async () => {
        const response = await transcribe(audioRequest());
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
            text: "We will follow up tomorrow.",
            language: "en",
        });
        expect(mockGetEngine.mock.invocationCallOrder[0]).toBeLessThan(
            mockProvider.mock.invocationCallOrder[0]!
        );
        expect(mockTranscribe).toHaveBeenCalledWith(expect.any(Buffer), "capture.wav", {
            mimeType: "audio/wav",
            timestamps: false,
        });
        expect((mockTranscribe.mock.calls[0]![0] as Buffer).byteLength).toBe(100);
    });

    it("rejects an oversized declared request before loading the provider", async () => {
        expect(
            (await transcribe(audioRequest(100, { "content-length": String(2 * 1024 * 1024 + 1) })))
                .status
        ).toBe(413);
        expect(mockProvider).not.toHaveBeenCalled();
    });

    it("caps chunked multipart bytes without relying on Content-Length", async () => {
        const encoded = audioRequest(2 * 1024 * 1024);
        // Incoming HTTP bytes are not a live undici FormData encoder. Materialize
        // the fixture before testing cancellation of an oversized request body.
        const incoming = new Request(encoded.url, {
            method: "POST",
            headers: encoded.headers,
            body: await encoded.arrayBuffer(),
        });
        expect((await transcribe(incoming)).status).toBe(413);
        expect(mockProvider).not.toHaveBeenCalled();
        expect(mockTranscribe).not.toHaveBeenCalled();
    });

    it("rejects invalid channels before invoking transcription", async () => {
        const form = new FormData();
        form.set("audio", new Blob([new Uint8Array(100)]), "capture.wav");
        form.set("channel", "combined");
        expect(
            (await transcribe(new Request("http://localhost", { method: "POST", body: form })))
                .status
        ).toBe(400);
        expect(mockProvider).not.toHaveBeenCalled();
    });

    it("does not disclose or log provider errors", async () => {
        const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
        try {
            mockTranscribe.mockRejectedValue(new Error("upstream echoed private audio payload"));
            const response = await transcribe(audioRequest());
            expect(response.status).toBe(503);
            expect(await response.text()).not.toContain("private audio");
            expect(log).not.toHaveBeenCalled();
        } finally {
            log.mockRestore();
        }
    });
});
