/**
 * /api/agents/predictive-document-analysis (+ /stream): requires a workspace
 * context and scopes the document to the caller's active company — foreign
 * documents read as 404, never analyzed.
 *
 * Scoping is enforced in SQL (`document.companyId = ctx.companyId`), so a
 * foreign document is indistinguishable from a missing one: the query simply
 * returns no rows.
 */

const mockRequireWorkspaceContext = jest.fn();

jest.mock("~/lib/require-workspace-context", () => ({
    ...jest.requireActual("~/lib/require-workspace-context"),
    requireWorkspaceContext: () => mockRequireWorkspaceContext(),
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
import { makeWorkspaceContext } from "../../helpers/workspace-context";

function mockAuthenticated(overrides: Parameters<typeof makeWorkspaceContext>[0] = {}) {
    mockRequireWorkspaceContext.mockResolvedValue({
        success: true,
        data: makeWorkspaceContext({
            authUserId: "user_session",
            userPk: BigInt(1),
            companyId: BigInt(5),
            role: "owner",
            ...overrides,
        }),
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

function requestFor(
    body: Record<string, unknown>,
    path = "/api/agents/predictive-document-analysis"
) {
    return new Request(`http://localhost${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
}

describe("POST /api/agents/predictive-document-analysis", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockSelectQueue.length = 0;
        mockAuthenticated();
    });

    it("returns 401 when there is no workspace context", async () => {
        mockUnauthenticated();
        const response = await POST(requestFor({ documentId: 1 }));
        expect(response.status).toBe(401);
    });

    it("returns 404 for a document owned by another company", async () => {
        // The company-scoped query matches nothing for a foreign document.
        mockSelectQueue.push([]); // document details

        const response = await POST(requestFor({ documentId: 1 }));
        const json = await response.json();

        expect(response.status).toBe(404);
        expect(json.message).toBe("Document not found.");
    });

    it("returns 404 for a document outside the caller's scope", async () => {
        mockAuthenticated({
            role: "member",
            scope: {
                kind: "except",
                deniedCategories: ["Finance"],
                deniedDocumentIds: [],
                allowedDocumentIds: [],
            },
        });
        // The scoped query matches nothing for a document the caller cannot see.
        mockSelectQueue.push([]); // document details

        const response = await POST(requestFor({ documentId: 1 }));
        const json = await response.json();

        expect(response.status).toBe(404);
        expect(json.message).toBe("Document not found.");
    });

    it("returns 403 for a role without documents.read", async () => {
        mockAuthenticated({ role: "reporting", permissions: ["analytics.view"] });

        const response = await POST(requestFor({ documentId: 1 }));

        expect(response.status).toBe(403);
        expect(await response.json()).toEqual({ error: "Forbidden", permission: "documents.read" });
    });

    it("serves the cached analysis for a same-company document", async () => {
        const cached = { documentId: 1, analysisType: "general", marker: "cached" };
        mockSelectQueue.push(
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
        mockAuthenticated();
    });

    it("returns 401 when there is no workspace context", async () => {
        mockUnauthenticated();
        const response = await streamPOST(
            requestFor({ documentId: 1 }, "/api/agents/predictive-document-analysis/stream")
        );
        expect(response.status).toBe(401);
    });

    it("returns 404 for a document owned by another company", async () => {
        // The company-scoped query matches nothing for a foreign document.
        mockSelectQueue.push([]); // doc check

        const response = await streamPOST(
            requestFor({ documentId: 1 }, "/api/agents/predictive-document-analysis/stream")
        );
        expect(response.status).toBe(404);
    });

    it("streams the cached result for a same-company document", async () => {
        const cached = { documentId: 1, marker: "cached-sse" };
        mockSelectQueue.push(
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
