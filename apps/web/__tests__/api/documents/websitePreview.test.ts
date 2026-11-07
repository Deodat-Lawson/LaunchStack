/** @jest-environment node */

/**
 * /api/documents/:id/website-preview: a picture of a saved website source.
 *
 * The contract under test: the page rendered is the document's own stored
 * HTML, looked up under the caller's scope (foreign or hidden documents read
 * as 404, other kinds of document as 415); the first open screenshots it
 * through Gotenberg, shrinks it to a WebP, stores it and records it on the row;
 * later opens serve the stored copy (or a 304) without rendering; a new
 * version of the HTML takes a new picture; and a missing renderer is a typed
 * 503 the viewer can explain.
 */

jest.mock("server-only", () => ({}), { virtual: true });

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
const mockUploadFile = jest.fn();
const mockDeleteFile = jest.fn();
const mockDeleteFileByUrl = jest.fn();

jest.mock("~/lib/storage", () => ({
    fetchFile: (url: string) => mockFetchFile(url),
    uploadFile: (input: unknown) => mockUploadFile(input),
    deleteFile: (url: string, provider: string) => mockDeleteFile(url, provider),
    deleteFileByUrl: (url: string) => mockDeleteFileByUrl(url),
}));

const mockGetGotenbergClient = jest.fn();

jest.mock("~/server/rendering", () => ({
    getGotenbergClient: () => mockGetGotenbergClient(),
}));

// select(): FIFO queue whatever the builder chain. update(): records what was
// set and resolves `returning()` with the next queued result.
const mockSelectQueue: unknown[][] = [];
const mockUpdateQueue: unknown[][] = [];
const mockUpdates: unknown[] = [];

function mockThenable(next: () => unknown[]) {
    const builder: Record<string, unknown> = {};
    for (const method of ["from", "where", "set", "returning"]) {
        builder[method] = (value?: unknown) => {
            if (method === "set") mockUpdates.push(value);
            return builder;
        };
    }
    builder.then = (onFulfilled: (v: unknown) => unknown, onRejected: (e: unknown) => unknown) =>
        Promise.resolve(next()).then(onFulfilled, onRejected);
    return builder;
}

jest.mock("~/server/db", () => ({
    db: {
        select: () => mockThenable(() => mockSelectQueue.shift() ?? []),
        update: () => mockThenable(() => mockUpdateQueue.shift() ?? []),
    },
}));

import sharp from "sharp";

import { RenderingServiceError } from "@launchstack/document-conversion-engine";
import { GET } from "~/app/api/documents/[id]/website-preview/route";
import {
    STORED_WIDTH,
    shrinkScreenshot,
    websitePreviewEtag,
    type WebsitePreviewRecord,
} from "~/server/website-preview";

import { makeWorkspaceContext } from "../../helpers/workspace-context";

const HTML_URL = "http://localhost:8333/pdr-documents/documents/abc-acme.html";
const SAVED_HTML =
    '<!doctype html><html><head><base href="https://acme.com/"></head><body><h1>Acme</h1></body></html>';

function call(id = "7", headers: Record<string, string> = {}) {
    return GET(new Request(`http://localhost/api/documents/${id}/website-preview`, { headers }), {
        params: Promise.resolve({ id }),
    });
}

function grantContext() {
    mockRequireWorkspaceContext.mockResolvedValue({
        success: true,
        data: makeWorkspaceContext({ companyId: BigInt(42), authUserId: "user_1" }),
    });
}

const marker = { kind: "website", url: "https://acme.com/", capturedAt: "2026-10-17T12:00:00Z" };

function storedRecord(overrides: Partial<WebsitePreviewRecord> = {}): WebsitePreviewRecord {
    return {
        url: "http://localhost:8333/pdr-documents/documents/old-preview.webp",
        source: HTML_URL,
        width: 1600,
        height: 1000,
        truncated: false,
        renderedAt: "2026-10-18T09:00:00Z",
        ...overrides,
    };
}

function queueDocument(ocrMetadata: Record<string, unknown> | null = marker) {
    mockSelectQueue.push([{ id: 7, url: HTML_URL, ocrMetadata }]);
}

/** What Gotenberg sends back: a 2× full-page JPEG of a 1,280-wide window. */
async function chromiumShot(width = 2560, height = 3000): Promise<Buffer> {
    return sharp({
        create: { width, height, channels: 3, background: { r: 245, g: 240, b: 230 } },
    })
        .jpeg()
        .toBuffer();
}

function okBody(body: string | Buffer, status = 200): Response {
    return new Response(typeof body === "string" ? body : new Uint8Array(body), { status });
}

let htmlToScreenshot: jest.Mock;

beforeEach(async () => {
    jest.clearAllMocks();
    mockSelectQueue.length = 0;
    mockUpdateQueue.length = 0;
    mockUpdates.length = 0;
    const shot = await chromiumShot();
    htmlToScreenshot = jest.fn().mockResolvedValue({
        image: shot,
        contentType: "image/jpeg",
        trace: "t-1",
    });
    mockGetGotenbergClient.mockReturnValue({ htmlToScreenshot });
    mockUploadFile.mockResolvedValue({
        url: "http://localhost:8333/pdr-documents/documents/new-preview.webp",
        pathname: "documents/new-preview.webp",
        provider: "s3",
    });
});

describe("GET /api/documents/:id/website-preview", () => {
    it("rejects a malformed id before touching auth", async () => {
        for (const id of ["abc", "0", "-3", "1.5"]) {
            expect((await call(id)).status).toBe(400);
        }
        expect(mockRequireWorkspaceContext).not.toHaveBeenCalled();
    });

    it("returns the workspace-context response when auth fails", async () => {
        mockRequireWorkspaceContext.mockResolvedValue({
            success: false,
            response: new Response(null, { status: 401 }),
        });
        expect((await call()).status).toBe(401);
    });

    it("404s a document the caller can't see, exactly like a missing one", async () => {
        grantContext();
        expect((await call()).status).toBe(404);
        expect(htmlToScreenshot).not.toHaveBeenCalled();
    });

    it("415s a document that is not a saved website", async () => {
        grantContext();
        queueDocument({ kind: "artifact" });
        const res = await call();
        expect(res.status).toBe(415);
        expect((await res.json()).error).toBe("not_website");
        expect(htmlToScreenshot).not.toHaveBeenCalled();
    });

    it("screenshots the stored HTML the first time, stores a WebP and records it", async () => {
        grantContext();
        queueDocument();
        mockFetchFile.mockResolvedValue(okBody(SAVED_HTML));
        mockUpdateQueue.push([{ id: 7 }]);

        const res = await call();

        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe("image/webp");
        expect(res.headers.get("cache-control")).toBe("private, no-cache");
        expect(res.headers.get("x-preview-truncated")).toBe("false");

        // The renderer got the document's own HTML, laid out in a laptop window.
        expect(mockFetchFile).toHaveBeenCalledWith(HTML_URL);
        expect(htmlToScreenshot).toHaveBeenCalledWith(
            expect.objectContaining({ html: SAVED_HTML, width: 1280, height: 800 })
        );

        const image = Buffer.from(await res.arrayBuffer());
        const meta = await sharp(image).metadata();
        expect(meta.format).toBe("webp");
        expect(meta.width).toBe(STORED_WIDTH);

        expect(mockUploadFile).toHaveBeenCalledWith(
            expect.objectContaining({
                contentType: "image/webp",
                userId: "user_1",
                companyId: BigInt(42),
            })
        );
        expect(mockUpdates).toHaveLength(1);
        expect(res.headers.get("etag")).toBe(
            websitePreviewEtag(
                storedRecord({
                    url: "http://localhost:8333/pdr-documents/documents/new-preview.webp",
                })
            )
        );
    });

    it("serves the stored picture without rendering again", async () => {
        grantContext();
        queueDocument({ ...marker, websitePreview: storedRecord() });
        const stored = await sharp(await chromiumShot(1600, 1000))
            .webp()
            .toBuffer();
        mockFetchFile.mockResolvedValue(okBody(stored));

        const res = await call();

        expect(res.status).toBe(200);
        expect(Buffer.from(await res.arrayBuffer()).equals(stored)).toBe(true);
        expect(mockFetchFile).toHaveBeenCalledWith(storedRecord().url);
        expect(htmlToScreenshot).not.toHaveBeenCalled();
        expect(mockUploadFile).not.toHaveBeenCalled();
    });

    it("answers 304 when the browser already has the stored picture", async () => {
        grantContext();
        queueDocument({ ...marker, websitePreview: storedRecord() });

        const res = await call("7", { "If-None-Match": websitePreviewEtag(storedRecord()) });

        expect(res.status).toBe(304);
        expect(mockFetchFile).not.toHaveBeenCalled();
        expect(htmlToScreenshot).not.toHaveBeenCalled();
    });

    it("takes a new picture for a new version of the page, and deletes the old one", async () => {
        grantContext();
        queueDocument({
            ...marker,
            websitePreview: storedRecord({ source: "http://localhost:8333/old.html" }),
        });
        mockFetchFile.mockResolvedValue(okBody(SAVED_HTML));
        mockUpdateQueue.push([{ id: 7 }]);

        const res = await call();

        expect(res.status).toBe(200);
        expect(htmlToScreenshot).toHaveBeenCalledTimes(1);
        expect(mockDeleteFileByUrl).toHaveBeenCalledWith(storedRecord().url);
    });

    it("takes the picture again when the stored file has gone", async () => {
        grantContext();
        queueDocument({ ...marker, websitePreview: storedRecord() });
        mockFetchFile.mockImplementation((url: string) =>
            Promise.resolve(url === HTML_URL ? okBody(SAVED_HTML) : okBody("gone", 404))
        );
        mockUpdateQueue.push([{ id: 7 }]);

        const res = await call();

        expect(res.status).toBe(200);
        expect(htmlToScreenshot).toHaveBeenCalledTimes(1);
    });

    it("drops the new picture when the document changed while it was taken", async () => {
        grantContext();
        queueDocument();
        mockFetchFile.mockResolvedValue(okBody(SAVED_HTML));
        mockUpdateQueue.push([]); // no row still pointing at that HTML

        const res = await call();

        expect(res.status).toBe(200);
        expect(mockDeleteFileByUrl).toHaveBeenCalledWith(
            "http://localhost:8333/pdr-documents/documents/new-preview.webp"
        );
    });

    it("503s with a typed error when there is no renderer", async () => {
        grantContext();
        queueDocument();
        mockGetGotenbergClient.mockReturnValue(null);

        const res = await call();

        expect(res.status).toBe(503);
        expect((await res.json()).error).toBe("service_not_configured");
    });

    it("502s, without the service's internals, when the render fails", async () => {
        grantContext();
        queueDocument();
        mockFetchFile.mockResolvedValue(okBody(SAVED_HTML));
        htmlToScreenshot.mockRejectedValue(
            new RenderingServiceError(503, "context deadline exceeded", "t-9")
        );
        const quiet = jest.spyOn(console, "error").mockImplementation(() => undefined);

        const res = await call();
        quiet.mockRestore();

        expect(res.status).toBe(502);
        const body = await res.json();
        expect(body.error).toBe("rendering_failed");
        expect(body.message).not.toContain("deadline");
        expect(mockUploadFile).not.toHaveBeenCalled();
    });

    it("502s when the saved HTML can't be read from storage", async () => {
        grantContext();
        queueDocument();
        mockFetchFile.mockResolvedValue(okBody("nope", 500));

        const res = await call();

        expect(res.status).toBe(502);
        expect((await res.json()).error).toBe("fetch_failed");
        expect(htmlToScreenshot).not.toHaveBeenCalled();
    });
});

describe("shrinkScreenshot", () => {
    it("scales a 2× shot down to the stored width", async () => {
        const out = await shrinkScreenshot(await chromiumShot(2560, 1200));
        expect(out).toMatchObject({ width: 1600, height: 750, truncated: false });
        expect((await sharp(out.data).metadata()).format).toBe("webp");
    });

    it("never enlarges a narrow shot", async () => {
        const out = await shrinkScreenshot(await chromiumShot(1280, 900));
        expect(out).toMatchObject({ width: 1280, height: 900, truncated: false });
    });

    it("keeps the top of a page taller than the limit and says so", async () => {
        const out = await shrinkScreenshot(await chromiumShot(400, 3000), {
            width: 200,
            maxHeight: 1000,
        });
        expect(out).toMatchObject({ width: 200, height: 1000, truncated: true });
        const meta = await sharp(out.data).metadata();
        expect([meta.width, meta.height]).toEqual([200, 1000]);
    });
});
