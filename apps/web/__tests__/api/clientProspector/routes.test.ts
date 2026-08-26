/**
 * Unit tests for Client Prospector API routes.
 * Feature: client-prospector
 *
 * These tests mock all external dependencies (Clerk auth, database, Inngest)
 * so we can test the route handlers in isolation. Each test verifies that
 * the route returns the correct HTTP status code and response body.
 *
 * Tests:
 *   - POST with valid input returns 202 with jobId
 *   - POST with empty query returns 400
 *   - POST with oversized companyContext returns 400
 *   - POST with missing location returns 400
 *   - GET /[jobId] returns 404 for wrong company
 *   - GET /[jobId] returns results when job is completed
 *
 * Validates: Requirements 1.1, 1.4, 1.5, 1.7, 5.2, 5.4
 */

import { NextRequest } from "next/server";

// ─── Mocks ───────────────────────────────────────────────────────────────────
// These must be set up BEFORE importing the route handlers, because
// Jest hoists jest.mock() calls to the top of the file.

// Mock the centralized auth+tenant resolver — we control the workspace
// context (or the failure response) per test.
const mockRequireWorkspaceContext = jest.fn();
jest.mock("~/lib/require-workspace-context", () => ({
    requireWorkspaceContext: () => mockRequireWorkspaceContext(),
}));

// Mock the schema export so drizzle-orm's eq() doesn't fail.
jest.mock("@launchstack/store/schema", () => ({
    users: { userId: "userId" },
}));

// Mock the client-prospector DB helpers.
const mockCreateJob = jest.fn();
const mockGetJobById = jest.fn();
const mockGetJobsByCompanyId = jest.fn();
jest.mock("@launchstack/pipelines/client-prospector/db", () => ({
    createJob: (...args: unknown[]) => mockCreateJob(...args),
    getJobById: (...args: unknown[]) => mockGetJobById(...args),
    getJobsByCompanyId: (...args: unknown[]) => mockGetJobsByCompanyId(...args),
}));

// Mock Inngest so we don't actually dispatch events.
const mockInngestSend = jest.fn();
jest.mock("~/server/inngest/client", () => ({
    inngest: {
        send: (...args: unknown[]) => mockInngestSend(...args),
    },
}));

// Pass rate limiting through — these tests exercise the handlers, not the
// limiter. Mocking the middleware also keeps the real in-memory store's
// cleanup setInterval from holding the Jest process open after the run.
jest.mock("~/lib/rate-limit-middleware", () => ({
    withRateLimit: jest.fn(
        async (_request: Request, _config: unknown, handler: () => Promise<unknown>) => handler()
    ),
}));

// Mock uuid so we get predictable job IDs.
jest.mock("uuid", () => ({
    v4: () => "test-job-id-1234",
}));

// ─── Import route handlers after mocks are set up ────────────────────────────

import { POST, GET } from "~/app/api/client-prospector/route";
import { GET as GET_JOB } from "~/app/api/client-prospector/[jobId]/route";

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Build a fake NextRequest with a JSON body.
function makePostRequest(body: unknown): NextRequest {
    return new NextRequest("http://localhost:3000/api/client-prospector", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
}

// Parse the JSON response body and status from a NextResponse.
async function parseResponse(response: Response) {
    const json = await response.json();
    return { status: response.status, body: json };
}

// Set up mocks so the user is authenticated and has an active workspace.
// requireWorkspaceContext owns the users lookup and workspace resolution, so
// the routes make no direct db calls of their own.
function mockAuthenticatedUser(userId = "user-123", companyId = 1001n) {
    mockRequireWorkspaceContext.mockResolvedValue({
        success: true,
        data: {
            clerkUserId: userId,
            userPk: BigInt(1),
            companyId,
            role: "owner",
            status: "verified",
        },
    });
}

function mockUnauthenticated() {
    mockRequireWorkspaceContext.mockResolvedValue({
        success: false,
        response: new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
        }),
    });
}

// A valid request body with all required fields.
const VALID_BODY = {
    query: "find law firms that need IT consulting",
    companyContext: "We are an IT consulting firm specializing in cloud migration",
    location: { lat: 30.2672, lng: -97.7431 },
    radius: 10000,
    categories: ["law-firms"],
};

// ─── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
    jest.clearAllMocks();
});

describe("POST /api/client-prospector", () => {
    it("returns 202 with jobId for valid input", async () => {
        mockAuthenticatedUser();
        mockCreateJob.mockResolvedValue({});
        mockInngestSend.mockResolvedValue({});

        const response = await POST(makePostRequest(VALID_BODY));
        const { status, body } = await parseResponse(response);

        expect(status).toBe(202);
        expect(body.jobId).toBe("test-job-id-1234");
        expect(body.status).toBe("queued");

        // Verify createJob was called with the right data.
        expect(mockCreateJob).toHaveBeenCalledTimes(1);
        expect(mockCreateJob).toHaveBeenCalledWith(
            expect.objectContaining({
                id: "test-job-id-1234",
                query: VALID_BODY.query,
                companyContext: VALID_BODY.companyContext,
                location: VALID_BODY.location,
                radius: VALID_BODY.radius,
                categories: VALID_BODY.categories,
            })
        );

        // Verify Inngest event was dispatched.
        expect(mockInngestSend).toHaveBeenCalledTimes(1);
        expect(mockInngestSend).toHaveBeenCalledWith(
            expect.objectContaining({
                name: "client-prospector/run.requested",
                data: expect.objectContaining({
                    jobId: "test-job-id-1234",
                    query: VALID_BODY.query,
                }),
            })
        );
    });

    it("returns 400 for empty query", async () => {
        mockAuthenticatedUser();

        const response = await POST(
            makePostRequest({
                ...VALID_BODY,
                query: "",
            })
        );
        const { status, body } = await parseResponse(response);

        expect(status).toBe(400);
        expect(body.error).toBe("Validation failed");
        expect(mockCreateJob).not.toHaveBeenCalled();
        expect(mockInngestSend).not.toHaveBeenCalled();
    });

    it("returns 400 for oversized companyContext", async () => {
        mockAuthenticatedUser();

        const response = await POST(
            makePostRequest({
                ...VALID_BODY,
                companyContext: "x".repeat(2001),
            })
        );
        const { status, body } = await parseResponse(response);

        expect(status).toBe(400);
        expect(body.error).toBe("Validation failed");
        expect(mockCreateJob).not.toHaveBeenCalled();
    });

    it("returns 400 for missing location", async () => {
        mockAuthenticatedUser();

        const { location: _, ...bodyWithoutLocation } = VALID_BODY;
        const response = await POST(makePostRequest(bodyWithoutLocation));
        const { status, body } = await parseResponse(response);

        expect(status).toBe(400);
        expect(body.error).toBe("Validation failed");
        expect(mockCreateJob).not.toHaveBeenCalled();
    });

    it("returns 401 when not authenticated", async () => {
        mockUnauthenticated();

        const response = await POST(makePostRequest(VALID_BODY));
        const { status, body } = await parseResponse(response);

        expect(status).toBe(401);
        expect(body.error).toBe("Unauthorized");
        expect(mockCreateJob).not.toHaveBeenCalled();
    });
});

describe("GET /api/client-prospector/[jobId]", () => {
    it("returns 404 for wrong company", async () => {
        // User is from company 1001, but the job belongs to a different company.
        // getJobById returns null when the company doesn't match.
        mockAuthenticatedUser("user-123", 1001n);
        mockGetJobById.mockResolvedValue(null);

        const response = await GET_JOB(
            new Request("http://localhost:3000/api/client-prospector/some-job-id"),
            { params: Promise.resolve({ jobId: "some-job-id" }) }
        );
        const { status, body } = await parseResponse(response);

        expect(status).toBe(404);
        expect(body.error).toBe("Not found");
    });

    it("returns results when job is completed", async () => {
        mockAuthenticatedUser("user-123", 1001n);

        const completedJob = {
            id: "job-abc",
            companyId: 1001n,
            userId: "user-123",
            status: "completed",
            input: {
                query: "find restaurants near me",
                companyContext: "We are a food delivery startup",
                location: { lat: 30.27, lng: -97.74 },
                radius: 5000,
                categories: ["restaurants"],
            },
            output: {
                results: [
                    {
                        fsqId: "fsq-1",
                        name: "Best Tacos",
                        address: "123 Main St",
                        location: { lat: 30.28, lng: -97.73 },
                        categories: ["Mexican"],
                        relevanceScore: 85,
                        rationale: "High foot traffic restaurant",
                    },
                ],
                metadata: {
                    query: "find restaurants near me",
                    companyContext: "We are a food delivery startup",
                    location: { lat: 30.27, lng: -97.74 },
                    radius: 5000,
                    categories: ["restaurants"],
                    createdAt: "2026-01-15T10:00:00.000Z",
                },
            },
            errorMessage: null,
            createdAt: new Date("2026-01-15T10:00:00.000Z"),
            completedAt: new Date("2026-01-15T10:00:05.000Z"),
        };

        mockGetJobById.mockResolvedValue(completedJob);

        const response = await GET_JOB(
            new Request("http://localhost:3000/api/client-prospector/job-abc"),
            { params: Promise.resolve({ jobId: "job-abc" }) }
        );
        const { status, body } = await parseResponse(response);

        expect(status).toBe(200);
        expect(body.id).toBe("job-abc");
        expect(body.status).toBe("completed");
        expect(body.results).toHaveLength(1);
        expect(body.results[0].name).toBe("Best Tacos");
        expect(body.results[0].relevanceScore).toBe(85);
        expect(body.completedAt).toBe("2026-01-15T10:00:05.000Z");
        expect(body.errorMessage).toBeNull();
    });

    it("returns 401 when not authenticated", async () => {
        mockUnauthenticated();

        const response = await GET_JOB(
            new Request("http://localhost:3000/api/client-prospector/some-job"),
            { params: Promise.resolve({ jobId: "some-job" }) }
        );
        const { status, body } = await parseResponse(response);

        expect(status).toBe(401);
        expect(body.error).toBe("Unauthorized");
    });
});
