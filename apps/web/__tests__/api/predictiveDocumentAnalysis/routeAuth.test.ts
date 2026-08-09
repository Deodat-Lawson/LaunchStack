/**
 * /api/agents/predictive-document-analysis (+ /stream): requires a Clerk
 * session and scopes the document to the caller's active company — foreign
 * documents read as 404, never analyzed.
 */

const mockClerk: { userId: string | null } = { userId: null };

jest.mock("@clerk/nextjs/server", () => ({
    auth: () => Promise.resolve({ userId: mockClerk.userId }),
}));

jest.mock("~/lib/active-workspace", () => ({
    resolveActiveCompanyForUser: jest.fn(),
}));

jest.mock("~/lib/rate-limit-middleware", () => ({
    withRateLimit: jest.fn(
        async (_request: unknown, _config: unknown, handler: () => Promise<unknown>) => handler()
    ),
}));

// The route imports RateLimitPresets from ~/lib/rate-limiter; loading the
// real module starts an un-unref'd cleanup setInterval that keeps the Jest
// process alive after the run, so mock the presets instead.
jest.mock("~/lib/rate-limiter", () => ({
    RateLimitPresets: {
        standard: { maxRequests: 100, windowMs: 15 * 60 * 1000 },
        strict: { maxRequests: 20, windowMs: 15 * 60 * 1000 },
        permissive: { maxRequests: 300, windowMs: 15 * 60 * 1000 },
        burst: { maxRequests: 10, windowMs: 60 * 1000 },
    },
}));

jest.mock("~/server/metrics/registry", () => ({
    predictiveAnalysisAiCalls: { observe: jest.fn() },
    predictiveAnalysisCacheHits: { inc: jest.fn() },
    predictiveAnalysisDuration: { startTimer: jest.fn(() => jest.fn()) },
    predictiveAnalysisRequests: { inc: jest.fn() },
}));

jest.mock("~/lib/integrations/slack", () => ({
    notifyOnCriticalFindings: jest.fn(() => Promise.resolve(false)),
}));

jest.mock("~/server/inngest/client", () => ({
    inngest: { send: jest.fn(() => Promise.resolve({ ids: ["evt"] })) },
}));

jest.mock("~/app/api/agents/predictive-document-analysis/agent", () => ({
    analyzeDocumentChunks: jest.fn(),
}));

// FIFO-queue db mock: each select() resolves the next queued result no
// matter how the drizzle builder chain is shaped.
const mockSelectQueue: unknown[][] = [];

function mockSelectBuilder() {
    const resolve = () => Promise.resolve(mockSelectQueue.shift() ?? []);
    const builder: Record<string, unknown> = {};
    for (const method of ["from", "where", "innerJoin", "leftJoin", "orderBy", "selectDistinct"]) {
        builder[method] = () => builder;
    }
    builder.limit = resolve;
    builder.then = (onFulfilled: (v: unknown) => unknown, onRejected: (e: unknown) => unknown) =>
        resolve().then(onFulfilled, onRejected);
    return builder;
}

jest.mock("~/server/db/index", () => ({
    db: {
        select: jest.fn(() => mockSelectBuilder()),
        selectDistinct: jest.fn(() => mockSelectBuilder()),
        insert: jest.fn(() => ({ values: jest.fn(() => Promise.resolve()) })),
    },
}));

import { POST } from "~/app/api/agents/predictive-document-analysis/route";
import { POST as streamPOST } from "~/app/api/agents/predictive-document-analysis/stream/route";
import { resolveActiveCompanyForUser } from "~/lib/active-workspace";

const resolveActiveCompanyForUserMock = resolveActiveCompanyForUser as jest.MockedFunction<
    typeof resolveActiveCompanyForUser
>;

function requestFor(body: Record<string, unknown>, path = "/api/agents/predictive-document-analysis") {
    return new Request(`http://localhost${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
}

const USER_ROW = { id: 1, companyId: 5n };

describe("POST /api/agents/predictive-document-analysis", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockSelectQueue.length = 0;
        mockClerk.userId = "user_session";
        resolveActiveCompanyForUserMock.mockResolvedValue(5n);
    });

    it("returns 401 when there is no Clerk session", async () => {
        mockClerk.userId = null;
        const response = await POST(requestFor({ documentId: 1 }));
        expect(response.status).toBe(401);
    });

    it("returns 404 for a document owned by another company", async () => {
        mockSelectQueue.push(
            [USER_ROW], // users lookup
            [
                {
                    title: "Foreign doc",
                    category: "x",
                    companyId: 9n,
                    currentVersionId: 2n,
                },
            ] // document details
        );

        const response = await POST(requestFor({ documentId: 1 }));
        const json = await response.json();

        expect(response.status).toBe(404);
        expect(json.message).toBe("Document not found.");
    });

    it("serves the cached analysis for a same-company document", async () => {
        const cached = { documentId: 1, analysisType: "general", marker: "cached" };
        mockSelectQueue.push(
            [USER_ROW], // users lookup
            [
                {
                    title: "My doc",
                    category: "x",
                    companyId: 5n,
                    currentVersionId: 2n,
                },
            ], // document details
            [{ resultJson: cached }] // cache hit
        );

        const response = await POST(requestFor({ documentId: 1 }));
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json).toMatchObject({ success: true, fromCache: true, marker: "cached" });
    });
});

describe("POST /api/agents/predictive-document-analysis/stream", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockSelectQueue.length = 0;
        mockClerk.userId = "user_session";
        resolveActiveCompanyForUserMock.mockResolvedValue(5n);
    });

    it("returns 401 when there is no Clerk session", async () => {
        mockClerk.userId = null;
        const response = await streamPOST(
            requestFor({ documentId: 1 }, "/api/agents/predictive-document-analysis/stream")
        );
        expect(response.status).toBe(401);
    });

    it("returns 404 for a document owned by another company", async () => {
        mockSelectQueue.push(
            [USER_ROW], // users lookup
            [{ id: 1, companyId: 9n, currentVersionId: 2n }] // doc check
        );

        const response = await streamPOST(
            requestFor({ documentId: 1 }, "/api/agents/predictive-document-analysis/stream")
        );
        expect(response.status).toBe(404);
    });

    it("streams the cached result for a same-company document", async () => {
        const cached = { documentId: 1, marker: "cached-sse" };
        mockSelectQueue.push(
            [USER_ROW], // users lookup
            [{ id: 1, companyId: 5n, currentVersionId: 2n }], // doc check
            [{ resultJson: cached }] // cache hit
        );

        const response = await streamPOST(
            requestFor({ documentId: 1 }, "/api/agents/predictive-document-analysis/stream")
        );
        expect(response.status).toBe(200);
        expect(response.headers.get("Content-Type")).toBe("text/event-stream");

        const body = await response.text();
        expect(body).toContain('"marker":"cached-sse"');
        expect(body).toContain('"fromCache":true');
    });
});
