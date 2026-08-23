import {
    CALL_NOTES_SCHEMA_VERSION,
    CallNotesApplicationError,
} from "@launchstack/features/call-notes";

const mockAuth = jest.fn();
const mockGetActiveCompanyId = jest.fn();
const mockGetApplication = jest.fn();
const mockListCalls = jest.fn();
const mockExecute = jest.fn();
const mockGetCall = jest.fn();
const mockSearchTranscript = jest.fn();
const mockListDetectedCalls = jest.fn();

jest.mock("@clerk/nextjs/server", () => ({
    auth: (...args: unknown[]) => mockAuth(...args),
}));

jest.mock("~/lib/active-workspace", () => ({
    getActiveCompanyId: (...args: unknown[]) => mockGetActiveCompanyId(...args),
}));

jest.mock("~/server/engine", () => ({
    getEngine: jest.fn(),
}));

jest.mock("~/server/call-notes/application", () => {
    const actual = jest.requireActual("~/server/call-notes/application");
    return {
        ...actual,
        getWebCallNotesApplication: () => mockGetApplication(),
    };
});

import { GET as getCall } from "~/app/api/call-notes/[callId]/route";
import { GET as getTranscript } from "~/app/api/call-notes/[callId]/transcript/route";
import { GET as getDetected } from "~/app/api/call-notes/detected/route";
import { GET as listCalls, POST as executeCommand } from "~/app/api/call-notes/route";

const APPLICATION = {
    listCalls: mockListCalls,
    execute: mockExecute,
    getCall: mockGetCall,
    searchTranscript: mockSearchTranscript,
    listDetectedCalls: mockListDetectedCalls,
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
    mockAuth.mockResolvedValue({ userId: "user_actual" });
    mockGetActiveCompanyId.mockResolvedValue(42n);
    mockGetApplication.mockReturnValue(APPLICATION);
    mockListCalls.mockResolvedValue([]);
    mockExecute.mockResolvedValue(null);
    mockGetCall.mockResolvedValue({ id: "call-1" });
    mockSearchTranscript.mockResolvedValue([]);
    mockListDetectedCalls.mockResolvedValue([]);
});

describe("Call Notes authenticated routes", () => {
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
                    provider: "zoom",
                    occurrenceKey: "zoom-occurrence-1",
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
            provider: "zoom",
            occurrenceKey: "zoom-occurrence-1",
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
                    provider: "zoom",
                    occurrenceKey: "zoom-occurrence-1",
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
