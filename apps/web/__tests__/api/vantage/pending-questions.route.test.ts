import { NextRequest, NextResponse } from "next/server";
import type { WorkspaceContextResult } from "~/lib/require-workspace-context";
import { makeWorkspaceContext } from "../../helpers/workspace-context";

const mockContext = jest.fn<Promise<WorkspaceContextResult>, []>();
const mockLoad = jest.fn();
const mockReview = jest.fn();
jest.mock("~/lib/require-workspace-context", () => ({
    requireWorkspaceContext: () => mockContext(),
}));
jest.mock("~/server/vantage/pending-questions", () => ({
    loadPendingQuestions: (...args: unknown[]) => mockLoad(...args),
    reviewPendingQuestion: (...args: unknown[]) => mockReview(...args),
}));
jest.mock("@launchstack/pipelines/vantage", () => ({
    VantageError: class VantageError extends Error {
        readonly status: number;
        readonly code: string;
        constructor(message: string, status: number, code: string) {
            super(message);
            this.status = status;
            this.code = code;
        }
    },
}));

import { VantageError } from "@launchstack/pipelines/vantage";
import { GET, PATCH } from "~/app/api/vantage/agendas/[id]/pending-questions/route";

const originalEnv = { ...process.env };
const params = { params: Promise.resolve({ id: "current-agenda" }) };
const view = {
    contractVersion: "pending-historical-questions/v1",
    agendaId: "current-agenda",
    version: 4,
    questions: [],
    unavailableCount: 0,
};
function request(body: unknown = {}) {
    return new NextRequest(
        "http://localhost/api/vantage/agendas/current-agenda/pending-questions",
        {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        }
    );
}
function signIn(overrides: Parameters<typeof makeWorkspaceContext>[0] = {}) {
    mockContext.mockResolvedValue({
        success: true,
        data: makeWorkspaceContext({ companyId: 42n, authUserId: "operator", ...overrides }),
    });
}
beforeEach(() => {
    jest.clearAllMocks();
    process.env.VANTAGE_TEST_MODE = "true";
    process.env.VANTAGE_TEST_COMPANY_ID = "42";
    process.env.VANTAGE_TEST_USER_IDS = "operator";
    process.env.DATABASE_URL = "postgres://test:test@localhost:55434/vantage_test";
    process.env.VANTAGE_TEST_DATABASE_URL = process.env.DATABASE_URL;
    signIn();
    mockLoad.mockResolvedValue(view);
    mockReview.mockResolvedValue({ ...view, version: 5 });
});
afterEach(() => {
    process.env = { ...originalEnv };
});

it("reads only the session actor/company and returns the separate extension unchanged", async () => {
    const response = await GET(request(), params);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual(view);
    expect(mockLoad).toHaveBeenCalledWith({
        companyId: 42n,
        userId: "operator",
        agendaId: "current-agenda",
    });
});

it.each(["dismissed", "addressed"])(
    "records %s against the original identity and exact version",
    async status => {
        const response = await PATCH(
            request({
                questionId: "original-topic",
                expectedVersion: 4,
                status,
            }),
            params
        );
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ ...view, version: 5 });
        expect(mockReview).toHaveBeenCalledWith({
            companyId: 42n,
            userId: "operator",
            agendaId: "current-agenda",
            questionId: "original-topic",
            expectedVersion: 4,
            status,
        });
    }
);

it("accepts the initial version zero for an existing legacy report", async () => {
    const response = await PATCH(
        request({ questionId: "original-topic", expectedVersion: 0, status: "dismissed" }),
        params
    );
    expect(response.status).toBe(200);
    expect(mockReview).toHaveBeenCalledWith({
        companyId: 42n,
        userId: "operator",
        agendaId: "current-agenda",
        questionId: "original-topic",
        expectedVersion: 0,
        status: "dismissed",
    });
});

it.each([GET, PATCH])(
    "rejects unauthenticated and excluded actors before reading historical text",
    async handler => {
        mockContext.mockResolvedValueOnce({
            success: false,
            response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
        });
        expect((await handler(request(), params)).status).toBe(401);
        for (const overrides of [
            { authUserId: "excluded" },
            { companyId: 43n },
            { permissions: ["documents.read"] as const },
            { permissions: ["documents.edit"] as const },
        ]) {
            signIn(overrides);
            expect((await handler(request(), params)).status).toBe(403);
        }
        expect(mockLoad).not.toHaveBeenCalled();
        expect(mockReview).not.toHaveBeenCalled();
    }
);

it.each([
    { expectedVersion: -1 },
    { expectedVersion: 1.5 },
    { expectedVersion: undefined },
    { status: "done" },
    { status: "pending" },
    { questionId: " " },
    { companyId: "43" },
    { userId: "forged" },
    { question: "replace original" },
    { reason: "x".repeat(501) },
])("rejects unsupported mutations and missing CAS fields: %p", async patch => {
    const response = await PATCH(
        request({
            questionId: "original-topic",
            expectedVersion: 4,
            status: "addressed",
            ...patch,
        }),
        params
    );
    expect(response.status).toBe(400);
    expect(mockReview).not.toHaveBeenCalled();
});

it.each(["{broken", "null", "[]", "42"])("rejects invalid JSON objects: %s", async body => {
    const response = await PATCH(
        new NextRequest("http://localhost/api/vantage/test", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body,
        }),
        params
    );
    expect(response.status).toBe(400);
    expect(mockReview).not.toHaveBeenCalled();
});

it("preserves version conflicts for the client to refresh without retrying a human review", async () => {
    mockReview.mockRejectedValue(new VantageError("The review changed.", 409, "version_conflict"));
    const response = await PATCH(
        request({ questionId: "original-topic", expectedVersion: 4, status: "dismissed" }),
        params
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
        error: "The review changed.",
        code: "version_conflict",
    });
    expect(mockReview).toHaveBeenCalledTimes(1);
});

it("preserves scoped not-found responses", async () => {
    mockLoad.mockRejectedValue(new VantageError("That agenda is not here.", 404, "not_found"));
    const response = await GET(request(), params);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "That agenda is not here.", code: "not_found" });
});

it("sanitizes unexpected provider/database errors", async () => {
    const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
    try {
        mockLoad.mockRejectedValue(new Error("private-source-text secret-token"));
        const response = await GET(request(), params);
        expect(response.status).toBe(500);
        expect(await response.json()).toEqual({ error: "Internal server error" });
        expect(JSON.stringify(log.mock.calls)).not.toMatch(/private-source-text|secret-token/);
    } finally {
        log.mockRestore();
    }
});
