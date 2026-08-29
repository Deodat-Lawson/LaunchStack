/**
 * /api/documents/pdf: renders a company-scoped Office document to PDF through
 * the Gotenberg service (ADR-009).
 *
 * The contract under test: company scoping is enforced in SQL (foreign
 * documents read as 404), only Office formats reach the service, a missing
 * Gotenberg deployment is a typed 503 rather than a crash, and service
 * errors map to relayed 4xx / opaque 502 like the adeu routes.
 */

const mockRequireWorkspaceContext = jest.fn();

jest.mock("~/lib/require-workspace-context", () => ({
    requireWorkspaceContext: () => mockRequireWorkspaceContext(),
}));

const mockFetchFile = jest.fn();

jest.mock("~/lib/storage", () => ({
    fetchFile: (url: string) => mockFetchFile(url),
}));

const mockGetGotenbergClient = jest.fn();

jest.mock("~/server/rendering", () => ({
    getGotenbergClient: () => mockGetGotenbergClient(),
}));

// FIFO-queue db mock: each select() resolves the next queued result no
// matter how the drizzle builder chain is shaped.
const mockSelectQueue: unknown[][] = [];

function mockSelectBuilder() {
    const resolve = () => Promise.resolve(mockSelectQueue.shift() ?? []);
    const builder: Record<string, unknown> = {};
    for (const method of ["from", "where"]) {
        builder[method] = () => builder;
    }
    builder.then = (onFulfilled: (v: unknown) => unknown, onRejected: (e: unknown) => unknown) =>
        resolve().then(onFulfilled, onRejected);
    return builder;
}

jest.mock("~/server/db", () => ({
    db: { select: () => mockSelectBuilder() },
}));

import { RenderingServiceError } from "@launchstack/document-conversion-engine";
import { GET } from "~/app/api/documents/pdf/route";

function request(query = "documentId=7"): Request {
    return new Request(`http://localhost/api/documents/pdf?${query}`);
}

function grantContext() {
    mockRequireWorkspaceContext.mockResolvedValue({
        success: true,
        data: { companyId: "42", clerkUserId: "user_1" },
    });
}

function queueDocument(overrides: Partial<Record<string, unknown>> = {}) {
    mockSelectQueue.push([
        {
            id: 7,
            title: "Contract.docx",
            url: "https://storage/contract.docx",
            fileType: "docx",
            ...overrides,
        },
    ]);
}

beforeEach(() => {
    jest.clearAllMocks();
    mockSelectQueue.length = 0;
});

describe("GET /api/documents/pdf", () => {
    it("rejects a missing or malformed documentId", async () => {
        for (const query of ["", "documentId=abc", "documentId=-1", "documentId=1.5"]) {
            const res = await GET(request(query));
            expect(res.status).toBe(400);
        }
        expect(mockRequireWorkspaceContext).not.toHaveBeenCalled();
    });

    it("returns the workspace-context response when auth fails", async () => {
        const denied = new Response(null, { status: 401 });
        mockRequireWorkspaceContext.mockResolvedValue({ success: false, response: denied });
        const res = await GET(request());
        expect(res.status).toBe(401);
    });

    it("404s a document outside the caller's company (or missing) identically", async () => {
        grantContext();
        // The scoped query returns no rows either way.
        const res = await GET(request());
        expect(res.status).toBe(404);
    });

    it("415s formats the LibreOffice route is not asked to handle", async () => {
        grantContext();
        queueDocument({ title: "scan.pdf", fileType: "pdf" });
        const res = await GET(request());
        expect(res.status).toBe(415);
        expect(mockGetGotenbergClient).not.toHaveBeenCalled();
    });

    it("503s with a typed error when Gotenberg is not configured", async () => {
        grantContext();
        queueDocument();
        mockGetGotenbergClient.mockReturnValue(null);
        const res = await GET(request());
        expect(res.status).toBe(503);
        const body = (await res.json()) as { error: string };
        expect(body.error).toBe("service_not_configured");
        // The document is never fetched for a conversion that cannot happen.
        expect(mockFetchFile).not.toHaveBeenCalled();
    });

    it("streams the rendered PDF with download headers", async () => {
        grantContext();
        queueDocument();
        const officeToPdf = jest
            .fn()
            .mockResolvedValue({ pdf: Buffer.from("%PDF-1.7 fake"), trace: "t-1" });
        mockGetGotenbergClient.mockReturnValue({ officeToPdf });
        mockFetchFile.mockResolvedValue(
            new Response(Buffer.from("PK\x03\x04docx"), { status: 200 })
        );

        const res = await GET(request());
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe("application/pdf");
        expect(res.headers.get("content-disposition")).toBe('attachment; filename="Contract.pdf"');
        expect(Buffer.from(await res.arrayBuffer()).toString()).toBe("%PDF-1.7 fake");
        expect(officeToPdf).toHaveBeenCalledWith(
            expect.objectContaining({ filename: "Contract.docx" })
        );
    });

    it("appends the extension when the title lacks one", async () => {
        grantContext();
        queueDocument({ title: "Contract", fileType: "docx" });
        const officeToPdf = jest.fn().mockResolvedValue({ pdf: Buffer.from("%PDF"), trace: null });
        mockGetGotenbergClient.mockReturnValue({ officeToPdf });
        mockFetchFile.mockResolvedValue(new Response(Buffer.from("PK"), { status: 200 }));

        await GET(request());
        expect(officeToPdf).toHaveBeenCalledWith(
            expect.objectContaining({ filename: "Contract.docx" })
        );
    });

    it("502s when storage cannot produce the document", async () => {
        grantContext();
        queueDocument();
        mockGetGotenbergClient.mockReturnValue({ officeToPdf: jest.fn() });
        mockFetchFile.mockResolvedValue(new Response(null, { status: 404 }));
        const res = await GET(request());
        expect(res.status).toBe(502);
    });

    it("relays a service 4xx and hides a service 5xx behind 502, with the trace", async () => {
        grantContext();
        queueDocument();
        mockFetchFile.mockResolvedValue(new Response(Buffer.from("PK"), { status: 200 }));

        const officeToPdf = jest
            .fn()
            .mockRejectedValueOnce(new RenderingServiceError(400, "malformed document", "t-4xx"))
            .mockRejectedValueOnce(new RenderingServiceError(500, "LibreOffice crashed", "t-5xx"));
        mockGetGotenbergClient.mockReturnValue({ officeToPdf });

        queueDocument();
        const relayed = await GET(request());
        expect(relayed.status).toBe(400);
        const relayedBody = (await relayed.json()) as { message: string };
        expect(relayedBody.message).toContain("malformed document");
        expect(relayedBody.message).toContain("t-4xx");

        const outage = await GET(request());
        expect(outage.status).toBe(502);
    });
});
