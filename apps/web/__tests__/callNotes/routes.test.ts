import type * as CallNotesApplicationModule from "~/server/call-notes/application";
import {
    CALL_NOTES_SCHEMA_VERSION,
    CallNotesApplicationError,
} from "@launchstack/features/call-notes";

const mockAuth = jest.fn();
const mockGetEngine = jest.fn();
const mockGetActiveCompanyId = jest.fn();
const mockGetApplication = jest.fn();
const mockListCalls = jest.fn();
const mockExecute = jest.fn();
const mockGetCall = jest.fn();
const mockSearchTranscript = jest.fn();
const mockListDetectedCalls = jest.fn();
const mockProcessQueuedEnrichment = jest.fn();
const mockWorkerStatus = jest.fn();
const mockServerEnv: Record<string, unknown> = {
    CALL_NOTES_CAPTURE_ENABLED: true,
    CALL_NOTES_LOCAL_COMPANY_ID: "42",
    CALL_NOTES_LOCAL_USER_ID: "user_actual",
};

jest.mock("~/env", () => ({
    get env() {
        return { server: mockServerEnv };
    },
}));

jest.mock("@clerk/nextjs/server", () => ({
    auth: (...args: unknown[]): unknown => mockAuth(...args),
}));

jest.mock("~/lib/active-workspace", () => ({
    getActiveCompanyId: (...args: unknown[]): unknown => mockGetActiveCompanyId(...args),
}));

jest.mock("~/server/engine", () => ({
    getEngine: (...args: unknown[]): unknown => mockGetEngine(...args),
}));

jest.mock("~/server/call-notes/enrichment-runner", () => ({
    processQueuedCallNotesEnrichment: (...args: unknown[]): unknown =>
        mockProcessQueuedEnrichment(...args),
}));

jest.mock("~/server/call-notes/application", () => {
    const actual = jest.requireActual<typeof CallNotesApplicationModule>(
        "~/server/call-notes/application"
    );
    return {
        ...actual,
        getWebCallNotesApplication: (): unknown => mockGetApplication(),
    };
});

import { GET as getCall } from "~/app/api/call-notes/[callId]/route";
import { GET as getTranscript } from "~/app/api/call-notes/[callId]/transcript/route";
import { GET as getDetected } from "~/app/api/call-notes/detected/route";
import { GET as listCalls, POST as executeCommand } from "~/app/api/call-notes/route";
import { GET as getWorkerStatus } from "~/app/api/call-notes/worker/route";

const APPLICATION = {
    listCalls: mockListCalls,
    execute: mockExecute,
    getCall: mockGetCall,
    searchTranscript: mockSearchTranscript,
    listDetectedCalls: mockListDetectedCalls,
    getLocalCaptureWorkerStatus: mockWorkerStatus,
};

function request(url: string, init?: RequestInit): Request {
    return new Request(`http://localhost${url}`, init);
}

async function responseBody(response: Response): Promise<unknown> {
    return response.json();
}

function callParams(callId: string) {
    return { params: Promise.resolve({ callId }) };
}
beforeEach(() => {
    jest.clearAllMocks();
    mockServerEnv.CALL_NOTES_CAPTURE_ENABLED = true;
    mockServerEnv.CALL_NOTES_LOCAL_COMPANY_ID = "42";
    mockServerEnv.CALL_NOTES_LOCAL_USER_ID = "user_actual";
    mockAuth.mockResolvedValue({ userId: "user_actual" });
    mockGetActiveCompanyId.mockResolvedValue(42n);
    mockGetApplication.mockReturnValue(APPLICATION);
    mockListCalls.mockResolvedValue([]);
    mockExecute.mockResolvedValue(null);
    mockGetCall.mockResolvedValue({ id: "call-1" });
    mockSearchTranscript.mockResolvedValue([]);
    mockListDetectedCalls.mockResolvedValue([]);
    mockWorkerStatus.mockResolvedValue({ available: true, lastSeenAt: "2026-09-06T00:00:00.000Z" });
});

describe("Call Notes authenticated routes", () => {
    it("does not expose worker availability without authentication", async () => {
        mockAuth.mockResolvedValue({ userId: null });
        expect((await getWorkerStatus()).status).toBe(401);
        expect(mockWorkerStatus).not.toHaveBeenCalled();
    });

    it("does not expose another configured user's worker as available", async () => {
        mockServerEnv.CALL_NOTES_LOCAL_USER_ID = "different-user";
        const response = await getWorkerStatus();
        expect(await responseBody(response)).toEqual({ available: false, lastSeenAt: null });
        expect(mockWorkerStatus).not.toHaveBeenCalled();
    });
    it("derives actor and company from Clerk and active workspace instead of GET query spoofing", async () => {
        const response = await listCalls(
            request("/api/call-notes?limit=7&companyId=999&actorUserId=attacker&limitOverride=1")
        );

        expect(response.status).toBe(200);
        expect(await responseBody(response)).toEqual([]);
        expect(mockListCalls).toHaveBeenCalledWith({
            companyId: "42",
            actorUserId: "user_actual",
            limit: 7,
        });
        expect(mockGetActiveCompanyId).toHaveBeenCalledWith("user_actual");
    });

    it("rebuilds POST command tenancy and actor fields when the client sends spoofed values", async () => {
        mockExecute.mockResolvedValue({ id: "call-1", status: "active" });
        const response = await executeCommand(
            request("/api/call-notes", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    schemaVersion: CALL_NOTES_SCHEMA_VERSION,
                    requestId: "dismiss-request",
                    kind: "dismiss_detected_occurrence",
                    companyId: "999",
                    actorUserId: "attacker",
                    source: "local_audio",
                    sourceOccurrenceKey: "local-occurrence-1",
                }),
            })
        );

        expect(response.status).toBe(200);
        expect(await responseBody(response)).toEqual({ id: "call-1", status: "active" });
        expect(mockExecute).toHaveBeenCalledWith({
            schemaVersion: CALL_NOTES_SCHEMA_VERSION,
            requestId: "dismiss-request",
            kind: "dismiss_detected_occurrence",
            companyId: "42",
            actorUserId: "user_actual",
            source: "local_audio",
            sourceOccurrenceKey: "local-occurrence-1",
        });
    });
    it("starts local audio capture without an external authorization reference", async () => {
        mockExecute.mockResolvedValue({ id: "call-1", status: "active" });
        const response = await executeCommand(
            request("/api/call-notes", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    schemaVersion: CALL_NOTES_SCHEMA_VERSION,
                    requestId: "start-request",
                    kind: "start_capture",
                    companyId: "999",
                    actorUserId: "attacker",
                    source: "remote_conference",
                    sourceOccurrenceKey: "local-occurrence-start",
                    title: "Local audio call",
                }),
            })
        );

        expect(response.status).toBe(200);
        expect(await responseBody(response)).toEqual({ id: "call-1", status: "active" });
        expect(mockExecute).toHaveBeenCalledWith({
            schemaVersion: CALL_NOTES_SCHEMA_VERSION,
            requestId: "start-request",
            kind: "start_capture",
            companyId: "42",
            actorUserId: "user_actual",
            source: "local_audio",
            sourceOccurrenceKey: "local-occurrence-start",
            title: "Local audio call",
        });
        expect(mockGetEngine).not.toHaveBeenCalled();
    });

    it("rejects explicit local start when no configured worker serves the actor", async () => {
        mockServerEnv.CALL_NOTES_LOCAL_USER_ID = "different-user";
        const response = await executeCommand(
            request("/api/call-notes", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    schemaVersion: CALL_NOTES_SCHEMA_VERSION,
                    requestId: "unserved-start",
                    kind: "start_capture",
                    source: "local_audio",
                    sourceOccurrenceKey: "local-occurrence-unserved",
                    title: "Local audio call",
                }),
            })
        );

        expect(response.status).toBe(503);
        expect(await responseBody(response)).toEqual({
            error: "No configured local capture worker serves this workspace user",
            code: "unavailable",
        });
        expect(mockExecute).not.toHaveBeenCalled();
    });

    it("passes an explicit stop command through the authenticated product route", async () => {
        mockExecute.mockResolvedValue({ id: "call-1", status: "finalizing" });
        const response = await executeCommand(
            request("/api/call-notes", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    schemaVersion: CALL_NOTES_SCHEMA_VERSION,
                    requestId: "stop-request",
                    kind: "stop_capture",
                    companyId: "spoofed",
                    actorUserId: "spoofed",
                    callId: "call-1",
                }),
            })
        );

        expect(response.status).toBe(200);
        expect(await responseBody(response)).toEqual({ id: "call-1", status: "finalizing" });
        expect(mockExecute).toHaveBeenCalledWith({
            schemaVersion: CALL_NOTES_SCHEMA_VERSION,
            requestId: "stop-request",
            kind: "stop_capture",
            companyId: "42",
            actorUserId: "user_actual",
            callId: "call-1",
        });
    });

    it("returns 401 before consulting the application when Clerk has no actor", async () => {
        mockAuth.mockResolvedValue({ userId: null });

        const response = await listCalls(request("/api/call-notes"));

        expect(response.status).toBe(401);
        expect(await responseBody(response)).toEqual({ error: "Unauthorized" });
        expect(mockGetActiveCompanyId).not.toHaveBeenCalled();
        expect(mockListCalls).not.toHaveBeenCalled();
    });

    it("returns 400 for malformed JSON and malformed command input", async () => {
        const malformedJson = await executeCommand(
            request("/api/call-notes", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: "{not-json",
            })
        );
        expect(malformedJson.status).toBe(400);
        expect(await responseBody(malformedJson)).toEqual({
            error: "Invalid Call Notes request",
        });

        const malformedCommand = await executeCommand(
            request("/api/call-notes", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    schemaVersion: CALL_NOTES_SCHEMA_VERSION,
                    requestId: "missing-kind",
                    companyId: "999",
                    actorUserId: "attacker",
                }),
            })
        );
        expect(malformedCommand.status).toBe(400);
        expect(mockExecute).not.toHaveBeenCalled();
    });

    it.each([
        ["not_found", 404],
        ["forbidden", 403],
        ["conflict", 409],
        ["invalid_transition", 422],
        ["unavailable", 503],
    ] as const)("maps application %s errors to HTTP %s", async (code, status) => {
        mockExecute.mockRejectedValue(new CallNotesApplicationError(code, `failure-${code}`));
        const response = await executeCommand(
            request("/api/call-notes", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    schemaVersion: CALL_NOTES_SCHEMA_VERSION,
                    requestId: `error-${code}`,
                    kind: "dismiss_detected_occurrence",
                    companyId: "spoofed",
                    actorUserId: "spoofed",
                    source: "local_audio",
                    sourceOccurrenceKey: "local-occurrence-1",
                }),
            })
        );

        expect(response.status).toBe(status);
        expect(await responseBody(response)).toEqual({
            error: `failure-${code}`,
            code,
        });
    });

    it("passes only server-derived context to detail, transcript, and detected handlers", async () => {
        const detail = await getCall(
            request("/api/call-notes/call-1?companyId=777&actorUserId=attacker"),
            callParams("call-1")
        );
        expect(detail.status).toBe(200);
        expect(mockGetCall).toHaveBeenCalledWith({
            companyId: "42",
            actorUserId: "user_actual",
            callId: "call-1",
        });

        const transcript = await getTranscript(
            request(
                "/api/call-notes/call-1/transcript?query=checklist&companyId=777&actorUserId=attacker"
            ),
            callParams("call-1")
        );
        expect(transcript.status).toBe(200);
        expect(mockSearchTranscript).toHaveBeenCalledWith({
            companyId: "42",
            actorUserId: "user_actual",
            callId: "call-1",
            query: "checklist",
        });

        const detected = await getDetected(
            request("/api/call-notes/detected?limit=3&companyId=777&actorUserId=attacker")
        );
        expect(detected.status).toBe(200);
        expect(mockListDetectedCalls).toHaveBeenCalledWith({
            companyId: "42",
            actorUserId: "user_actual",
            limit: 3,
        });
    });

    it("maps route-level validation and application errors for dynamic handlers", async () => {
        const invalidCallId = await getCall(request("/api/call-notes/"), callParams(""));
        expect(invalidCallId.status).toBe(400);

        mockGetCall.mockRejectedValue(new CallNotesApplicationError("not_found", "call not found"));
        const missing = await getCall(
            request("/api/call-notes/call-missing"),
            callParams("call-missing")
        );
        expect(missing.status).toBe(404);
        expect(await responseBody(missing)).toEqual({
            error: "call not found",
            code: "not_found",
        });

        mockSearchTranscript.mockRejectedValue(
            new CallNotesApplicationError("forbidden", "transcript forbidden")
        );
        const forbidden = await getTranscript(
            request("/api/call-notes/call-1/transcript?query=secret"),
            callParams("call-1")
        );
        expect(forbidden.status).toBe(403);
        expect(await responseBody(forbidden)).toEqual({
            error: "transcript forbidden",
            code: "forbidden",
        });

        mockListDetectedCalls.mockRejectedValue(new Error("database unavailable"));
        const unavailable = await getDetected(request("/api/call-notes/detected"));
        expect(unavailable.status).toBe(503);
        expect(await responseBody(unavailable)).toEqual({
            error: "Call Notes is unavailable",
        });
    });
});
