/**
 * /api/documents/[id]/preview: the document rendered to PDF for viewing in
 * place, kept per version.
 *
 * The contract under test: the same scoping and format gates as the download
 * route, an inline disposition, a version ETag that turns a repeat request
 * into a 304 before anything is fetched or rendered, one render per version
 * however many readers ask, and failures that are reported but never kept.
 */

import type * as MockRequireWorkspaceContext from "../../helpers/mock-require-workspace-context";

const mockRequireWorkspaceContext = jest.fn();

jest.mock("~/lib/require-workspace-context", () =>
    jest
        .requireActual<
            typeof MockRequireWorkspaceContext
        >("../../helpers/mock-require-workspace-context")
        .workspaceContextModuleMock(() => mockRequireWorkspaceContext())
);

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
import { GET } from "~/app/api/documents/[id]/preview/route";
import { pdfPreviewCache } from "~/server/services/pdf-preview-cache";

import { makeWorkspaceContext } from "../../helpers/workspace-context";

function request(id = "7", headers: Record<string, string> = {}) {
    return [
        new Request(`http://localhost/api/documents/${id}/preview`, { headers }),
        { params: Promise.resolve({ id }) },
    ] as const;
}

function grantContext() {
    mockRequireWorkspaceContext.mockResolvedValue({
        success: true,
        data: makeWorkspaceContext({ companyId: BigInt(42), authUserId: "user_1" }),
    });
}

function queueDocument(overrides: Partial<Record<string, unknown>> = {}) {
    mockSelectQueue.push([
        {
            id: 7,
            title: "Pitch.pptx",
            url: "https://storage/pitch.pptx",
            fileType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            currentVersionId: BigInt(31),
            ...overrides,
        },
    ]);
}

function gotenbergRendering(pdf = "%PDF-1.7 slides") {
    const officeToPdf = jest.fn().mockResolvedValue({ pdf: Buffer.from(pdf), trace: "t-1" });
    mockGetGotenbergClient.mockReturnValue({ officeToPdf });
    // A Response body reads once: a fresh one per fetch.
    mockFetchFile.mockImplementation(() =>
        Promise.resolve(new Response(Buffer.from("PK\x03\x04pptx"), { status: 200 }))
    );
    return officeToPdf;
}

beforeEach(() => {
    jest.clearAllMocks();
    mockSelectQueue.length = 0;
    pdfPreviewCache.clear();
});

describe("GET /api/documents/[id]/preview", () => {
    it("rejects a malformed id before touching auth", async () => {
        for (const id of ["abc", "-1", "1.5", "0"]) {
            const res = await GET(...request(id));
            expect(res.status).toBe(400);
        }
        expect(mockRequireWorkspaceContext).not.toHaveBeenCalled();
    });

    it("returns the workspace-context response when auth fails", async () => {
        const denied = new Response(null, { status: 401 });
        mockRequireWorkspaceContext.mockResolvedValue({ success: false, response: denied });
        const res = await GET(...request());
        expect(res.status).toBe(401);
    });

    it("404s a document outside the caller's company (or missing) identically", async () => {
        grantContext();
        const res = await GET(...request());
        expect(res.status).toBe(404);
    });

    it("415s formats the LibreOffice route is not asked to handle", async () => {
        grantContext();
        queueDocument({ title: "scan.pdf", fileType: "pdf" });
        const res = await GET(...request());
        expect(res.status).toBe(415);
        expect(mockGetGotenbergClient).not.toHaveBeenCalled();
    });

    it("503s with a typed error when Gotenberg is not configured, and keeps nothing", async () => {
        grantContext();
        queueDocument();
        mockGetGotenbergClient.mockReturnValue(null);
        const res = await GET(...request());
        expect(res.status).toBe(503);
        await expect(res.json()).resolves.toMatchObject({ error: "service_not_configured" });
        expect(mockFetchFile).not.toHaveBeenCalled();
        expect(pdfPreviewCache.size).toBe(0);
    });

    it("serves the rendered PDF inline, tagged with the version", async () => {
        grantContext();
        queueDocument();
        const officeToPdf = gotenbergRendering();

        const res = await GET(...request());
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe("application/pdf");
        expect(res.headers.get("content-disposition")).toBe('inline; filename="Pitch.pdf"');
        expect(res.headers.get("etag")).toBe('"7:v31"');
        expect(res.headers.get("cache-control")).toBe("private, no-cache");
        expect(Buffer.from(await res.arrayBuffer()).toString()).toBe("%PDF-1.7 slides");
        expect(officeToPdf).toHaveBeenCalledWith(
            expect.objectContaining({ filename: "Pitch.pptx" })
        );
    });

    it("renders a version once: the next reader is served from memory", async () => {
        grantContext();
        const officeToPdf = gotenbergRendering();

        queueDocument();
        await GET(...request());
        queueDocument();
        const again = await GET(...request());

        expect(again.status).toBe(200);
        expect(Buffer.from(await again.arrayBuffer()).toString()).toBe("%PDF-1.7 slides");
        expect(officeToPdf).toHaveBeenCalledTimes(1);
        expect(mockFetchFile).toHaveBeenCalledTimes(1);
    });

    it("answers a matching If-None-Match with 304 before fetching or rendering", async () => {
        grantContext();
        queueDocument();
        const officeToPdf = gotenbergRendering();

        const res = await GET(...request("7", { "if-none-match": '"7:v31"' }));
        expect(res.status).toBe(304);
        expect(res.headers.get("etag")).toBe('"7:v31"');
        expect(officeToPdf).not.toHaveBeenCalled();
        expect(mockFetchFile).not.toHaveBeenCalled();
    });

    it("re-renders when the document moves to a new version", async () => {
        grantContext();
        const officeToPdf = gotenbergRendering();

        queueDocument({ currentVersionId: BigInt(31) });
        const first = await GET(...request());
        queueDocument({ currentVersionId: BigInt(32), url: "https://storage/pitch-v2.pptx" });
        const second = await GET(...request("7", { "if-none-match": '"7:v31"' }));

        expect(first.headers.get("etag")).toBe('"7:v31"');
        expect(second.status).toBe(200);
        expect(second.headers.get("etag")).toBe('"7:v32"');
        expect(officeToPdf).toHaveBeenCalledTimes(2);
    });

    it("keys a never-versioned row by where its bytes live", async () => {
        grantContext();
        gotenbergRendering();
        queueDocument({ currentVersionId: null });
        const res = await GET(...request());
        expect(res.headers.get("etag")).toMatch(/^"7:u[0-9a-f]{12}"$/);
    });

    it("shares one render between readers who ask at the same time", async () => {
        grantContext();
        let release!: (value: { pdf: Buffer; trace: string }) => void;
        const officeToPdf = jest.fn().mockReturnValue(
            new Promise<{ pdf: Buffer; trace: string }>(resolve => {
                release = resolve;
            })
        );
        mockGetGotenbergClient.mockReturnValue({ officeToPdf });
        mockFetchFile.mockImplementation(() =>
            Promise.resolve(new Response(Buffer.from("PK"), { status: 200 }))
        );

        queueDocument();
        queueDocument();
        const a = GET(...request());
        const b = GET(...request());
        // Let both requests reach the render before it resolves.
        await new Promise(resolve => setTimeout(resolve, 0));
        release({ pdf: Buffer.from("%PDF shared"), trace: "t" });

        const [resA, resB] = await Promise.all([a, b]);
        expect(resA.status).toBe(200);
        expect(resB.status).toBe(200);
        expect(Buffer.from(await resB.arrayBuffer()).toString()).toBe("%PDF shared");
        expect(officeToPdf).toHaveBeenCalledTimes(1);
    });

    it("relays a render failure without keeping it, so a retry renders again", async () => {
        grantContext();
        mockFetchFile.mockImplementation(() =>
            Promise.resolve(new Response(Buffer.from("PK"), { status: 200 }))
        );
        const officeToPdf = jest
            .fn()
            .mockRejectedValueOnce(new RenderingServiceError(500, "LibreOffice crashed", "t-5xx"))
            .mockResolvedValueOnce({ pdf: Buffer.from("%PDF ok"), trace: "t-ok" });
        mockGetGotenbergClient.mockReturnValue({ officeToPdf });

        queueDocument();
        const outage = await GET(...request());
        expect(outage.status).toBe(502);
        await expect(outage.json()).resolves.toMatchObject({ error: "rendering_failed" });

        queueDocument();
        const recovered = await GET(...request());
        expect(recovered.status).toBe(200);
        expect(officeToPdf).toHaveBeenCalledTimes(2);
    });

    it("words its refusals in the reader's language", async () => {
        grantContext();
        queueDocument({ title: "scan.pdf", fileType: "pdf" });
        const res = await GET(...request("7", { cookie: "ls-locale=zh-CN.1" }));
        expect(res.status).toBe(415);
        await expect(res.json()).resolves.toMatchObject({
            error: "unsupported_type",
            message: "此文档已经是 PDF，请直接下载。",
        });
    });
});
