import type * as MockRequireWorkspaceContext from "../../helpers/mock-require-workspace-context";

import { GET } from "~/app/api/files/[id]/route";
import { signFileAccessToken } from "@launchstack/store/crypto";
import { fetchFile } from "~/lib/storage";
import type { WorkspaceContextResult } from "~/lib/require-workspace-context";

import {
    makeWorkspaceContext,
    type WorkspaceContextOverrides,
} from "../../helpers/workspace-context";

const SECRET = "route-file-access-secret";

const mockRequireWorkspaceContext = jest.fn<Promise<WorkspaceContextResult>, []>();

jest.mock("~/lib/require-workspace-context", () =>
    jest
        .requireActual<
            typeof MockRequireWorkspaceContext
        >("../../helpers/mock-require-workspace-context")
        .workspaceContextModuleMock(() => mockRequireWorkspaceContext())
);

jest.mock("~/env", () => ({
    env: {
        server: { FILE_ACCESS_TOKEN_SECRET: "route-file-access-secret" },
        client: {},
    },
}));

const mockDbSelect = jest.fn();

jest.mock("~/server/db", () => ({
    db: {
        select: (...args: unknown[]) => mockDbSelect(...args) as unknown,
    },
}));

jest.mock("~/server/storage/vercel-blob", () => ({
    isPrivateBlobUrl: () => false,
}));

jest.mock("~/lib/storage", () => ({
    fetchFile: jest.fn(),
}));

const DB_FILE = {
    id: 123,
    userId: "clerk_abc",
    companyId: BigInt(5),
    filename: "notes.txt",
    mimeType: "text/plain",
    storageProvider: "database",
    storageUrl: null,
    fileData: Buffer.from("hello worker").toString("base64"),
};

const DB_FILE_LEGACY = {
    ...DB_FILE,
    companyId: null,
};

function mockAuthenticated(overrides?: WorkspaceContextOverrides) {
    const data = makeWorkspaceContext({ authUserId: "clerk_abc", ...overrides });
    mockRequireWorkspaceContext.mockResolvedValue({ success: true, data });
}

function mockUnauthenticated() {
    mockRequireWorkspaceContext.mockResolvedValue({
        success: false,
        response: new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
        }),
    } as WorkspaceContextResult);
}

function setupFileQuery(rows: Record<string, unknown>[]) {
    const where = jest.fn().mockResolvedValue(rows);
    const from = jest.fn().mockReturnValue({ where });
    mockDbSelect.mockReturnValueOnce({ from });
}

/** The documents (and versions) whose bytes this file is — the scope check's read. */
function setupBackingDocumentsQuery(rows: { id: number; category: string }[]) {
    const where = jest.fn().mockResolvedValue(rows);
    const leftJoin = jest.fn().mockReturnValue({ where });
    const from = jest.fn().mockReturnValue({ leftJoin });
    mockDbSelect.mockReturnValueOnce({ from });
}

const HIDES_BOARD = {
    kind: "except" as const,
    deniedCategories: ["Board"],
    deniedDocumentIds: [],
    allowedDocumentIds: [],
};

function request(path: string, headers?: Record<string, string>) {
    return new Request(`http://localhost${path}`, { headers });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe("GET /api/files/[id]", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockUnauthenticated();
    });

    it("returns 401 for an anonymous request with no token", async () => {
        const response = await GET(request("/api/files/123"), params("123"));

        expect(response.status).toBe(401);
        expect(await response.json()).toEqual({ error: "Unauthorized" });
    });

    it("serves the file to a signed-in user who owns it", async () => {
        mockAuthenticated();
        setupFileQuery([DB_FILE]);

        const response = await GET(request("/api/files/123"), params("123"));

        expect(response.status).toBe(200);
        expect(await response.text()).toBe("hello worker");
    });

    it("returns 404 when file belongs to a different company", async () => {
        mockAuthenticated({ companyId: BigInt(999) });
        setupFileQuery([DB_FILE]);

        const response = await GET(request("/api/files/123"), params("123"));

        expect(response.status).toBe(404);
    });

    it("returns 404 for a row with no company stamp", async () => {
        mockAuthenticated();
        setupFileQuery([DB_FILE_LEGACY]);

        const response = await GET(request("/api/files/123"), params("123"));

        expect(response.status).toBe(404);
        expect(mockDbSelect).toHaveBeenCalledTimes(1);
    });

    it("skips the document lookup entirely when the caller sees everything", async () => {
        mockAuthenticated();
        setupFileQuery([DB_FILE]);

        const response = await GET(request("/api/files/123"), params("123"));

        expect(response.status).toBe(200);
        expect(mockDbSelect).toHaveBeenCalledTimes(1);
    });

    it("returns 404 when the file backs a document outside the caller's scope", async () => {
        mockAuthenticated({ role: "member", scope: HIDES_BOARD });
        setupFileQuery([DB_FILE]);
        setupBackingDocumentsQuery([{ id: 9, category: "Board" }]);

        const response = await GET(request("/api/files/123"), params("123"));

        expect(response.status).toBe(404);
        expect(await response.json()).toEqual({ error: "File not found" });
    });

    it("serves a file whose document is inside the caller's scope", async () => {
        mockAuthenticated({ role: "member", scope: HIDES_BOARD });
        setupFileQuery([DB_FILE]);
        setupBackingDocumentsQuery([{ id: 9, category: "General" }]);

        const response = await GET(request("/api/files/123"), params("123"));

        expect(response.status).toBe(200);
    });

    it("serves a file no document references yet (mid-upload) on company scope alone", async () => {
        mockAuthenticated({ role: "member", scope: HIDES_BOARD });
        setupFileQuery([DB_FILE]);
        setupBackingDocumentsQuery([]);

        const response = await GET(request("/api/files/123"), params("123"));

        expect(response.status).toBe(200);
    });

    it("serves the file to a caller holding a valid token (skips ownership)", async () => {
        const token = signFileAccessToken("123", SECRET);
        setupFileQuery([DB_FILE]);

        const response = await GET(request(`/api/files/123?t=${token}`), params("123"));

        expect(response.status).toBe(200);
        expect(mockRequireWorkspaceContext).not.toHaveBeenCalled();
    });

    it("rejects a token minted for a different file", async () => {
        const token = signFileAccessToken("999", SECRET);

        const response = await GET(request(`/api/files/123?t=${token}`), params("123"));

        expect(response.status).toBe(401);
    });

    it("rejects an expired token", async () => {
        const token = signFileAccessToken("123", SECRET, {
            ttlMs: 1000,
            now: Date.now() - 5000,
        });

        const response = await GET(request(`/api/files/123?t=${token}`), params("123"));

        expect(response.status).toBe(401);
    });

    it("returns 400 for a non-numeric id", async () => {
        const response = await GET(request("/api/files/abc"), params("abc"));

        expect(response.status).toBe(400);
    });

    it("returns 404 when the file row is missing", async () => {
        mockAuthenticated();
        setupFileQuery([]);

        const response = await GET(request("/api/files/123"), params("123"));

        expect(response.status).toBe(404);
    });
});

describe("GET /api/files/[id] response headers", () => {
    const fetchFileMock = jest.mocked(fetchFile);
    const SCRIPT = "<script>fetch('/api/me', { credentials: 'include' })</script>";

    beforeEach(() => {
        jest.clearAllMocks();
        mockAuthenticated();
    });

    function serve(file: Record<string, unknown>) {
        setupFileQuery([{ ...DB_FILE, fileData: Buffer.from(SCRIPT).toString("base64"), ...file }]);
        return GET(request("/api/files/123"), params("123"));
    }

    it.each([
        ["HTML", "page.html", "text/html"],
        ["SVG", "logo.svg", "image/svg+xml"],
    ])(
        "sandboxes stored %s so its scripts cannot run on this origin",
        async (_, filename, type) => {
            const response = await serve({ filename, mimeType: type });

            expect(response.status).toBe(200);
            expect(response.headers.get("Content-Security-Policy")).toBe("sandbox");
            expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
            expect(response.headers.get("Content-Type")).toBe(type);
            // Still inline: it renders (inert) rather than turning into a download.
            expect(response.headers.get("Content-Disposition")).toMatch(/^inline;/);
            expect(await response.text()).toBe(SCRIPT);
        }
    );

    it("judges the stored type, not the file name", async () => {
        // /api/upload-local accepts a file on its extension alone.
        const response = await serve({ filename: "report.pdf", mimeType: "text/html" });

        expect(response.headers.get("Content-Security-Policy")).toBe("sandbox");
    });

    it("sandboxes HTML whose type is inferred from its name", async () => {
        const response = await serve({ filename: "page.html", mimeType: null });

        expect(response.headers.get("Content-Type")).toBe("text/html");
        expect(response.headers.get("Content-Security-Policy")).toBe("sandbox");
    });

    it.each([
        ["PDF", "report.pdf", "application/pdf"],
        ["PNG", "chart.png", "image/png"],
        ["JPEG", "photo.jpg", "image/jpeg"],
    ])(
        "serves a %s outside the sandbox, for the browser's own viewer",
        async (_, filename, type) => {
            const response = await serve({ filename, mimeType: type });

            expect(response.status).toBe(200);
            expect(response.headers.get("Content-Security-Policy")).toBeNull();
            expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
            expect(response.headers.get("Content-Type")).toBe(type);
        }
    );

    describe("proxied from object storage", () => {
        const S3_FILE = {
            storageProvider: "s3",
            storageUrl: "https://s3.example.test/documents/abc",
            fileData: null,
        };

        it("sandboxes by the type storage reports", async () => {
            fetchFileMock.mockResolvedValue(
                new Response(SCRIPT, { headers: { "content-type": "text/html" } })
            );

            const response = await serve({ ...S3_FILE, filename: "page.html" });

            // No Range from the browser, so none is forwarded.
            expect(fetchFileMock).toHaveBeenCalledWith(S3_FILE.storageUrl, undefined);
            expect(response.headers.get("Content-Security-Policy")).toBe("sandbox");
            expect(response.headers.get("Content-Type")).toBe("text/html");
            expect(await response.text()).toBe(SCRIPT);
        });

        it("rebuilds a reported type rather than echoing it", async () => {
            // A browser reads a Content-Type list as its last entry.
            fetchFileMock.mockResolvedValue(
                new Response(SCRIPT, { headers: { "content-type": "image/png, text/html" } })
            );

            const response = await serve({ ...S3_FILE, filename: "chart.png" });

            expect(response.headers.get("Content-Type")).toBe("application/octet-stream");
            expect(response.headers.get("Content-Security-Policy")).toBe("sandbox");
        });

        it("serves a PDF outside the sandbox", async () => {
            fetchFileMock.mockResolvedValue(
                new Response("%PDF-1.7", { headers: { "content-type": "application/pdf" } })
            );

            const response = await serve({ ...S3_FILE, filename: "report.pdf" });

            expect(response.headers.get("Content-Security-Policy")).toBeNull();
            expect(response.headers.get("Content-Type")).toBe("application/pdf");
        });
    });
});

/**
 * A `<video>`/`<audio>` element seeks by asking for a byte range; a server
 * that ignores it leaves the player unable to seek.
 */
describe("GET /api/files/[id] byte ranges", () => {
    const fetchFileMock = jest.mocked(fetchFile);
    const BYTES = "0123456789";

    beforeEach(() => {
        jest.clearAllMocks();
        mockAuthenticated();
    });

    function serveVideo(headers?: Record<string, string>, file?: Record<string, unknown>) {
        setupFileQuery([
            {
                ...DB_FILE,
                filename: "standup.mp4",
                mimeType: "video/mp4",
                fileData: Buffer.from(BYTES).toString("base64"),
                ...file,
            },
        ]);
        return GET(request("/api/files/123", headers), params("123"));
    }

    it("says ranges are accepted on a whole-file answer", async () => {
        const response = await serveVideo();

        expect(response.status).toBe(200);
        expect(response.headers.get("Accept-Ranges")).toBe("bytes");
        expect(response.headers.get("Content-Length")).toBe("10");
        expect(await response.text()).toBe(BYTES);
    });

    it("serves the requested slice of a database-stored file as 206", async () => {
        const response = await serveVideo({ Range: "bytes=2-5" });

        expect(response.status).toBe(206);
        expect(response.headers.get("Content-Range")).toBe("bytes 2-5/10");
        expect(response.headers.get("Content-Length")).toBe("4");
        expect(response.headers.get("Content-Type")).toBe("video/mp4");
        expect(response.headers.get("Content-Disposition")).toMatch(/^inline;/);
        expect(await response.text()).toBe("2345");
    });

    it("serves an open-ended seek to the end of the file", async () => {
        const response = await serveVideo({ Range: "bytes=7-" });

        expect(response.status).toBe(206);
        expect(await response.text()).toBe("789");
    });

    it("answers 416 for a range past the end", async () => {
        const response = await serveVideo({ Range: "bytes=50-" });

        expect(response.status).toBe(416);
        expect(response.headers.get("Content-Range")).toBe("bytes */10");
    });

    it("still checks ownership before serving any range", async () => {
        mockAuthenticated({ companyId: BigInt(999) });

        const response = await serveVideo({ Range: "bytes=0-1" });

        expect(response.status).toBe(404);
    });

    it("infers a media type from the file name when none was stored", async () => {
        const response = await serveVideo(undefined, { mimeType: null, filename: "memo.m4a" });

        expect(response.headers.get("Content-Type")).toBe("audio/mp4");
        expect(response.headers.get("Content-Security-Policy")).toBeNull();
    });

    describe("proxied from object storage", () => {
        const S3_FILE = {
            storageProvider: "s3",
            storageUrl: "https://s3.example.test/documents/clip",
            fileData: null,
        };

        it("forwards the range to storage and relays its 206", async () => {
            fetchFileMock.mockResolvedValue(
                new Response("2345", {
                    status: 206,
                    headers: {
                        "content-type": "video/mp4",
                        "content-range": "bytes 2-5/10",
                        "content-length": "4",
                    },
                })
            );

            const response = await serveVideo({ Range: "bytes=2-5" }, S3_FILE);

            expect(fetchFileMock).toHaveBeenCalledWith(S3_FILE.storageUrl, {
                headers: { Range: "bytes=2-5" },
            });
            expect(response.status).toBe(206);
            expect(response.headers.get("Content-Range")).toBe("bytes 2-5/10");
            expect(response.headers.get("Content-Length")).toBe("4");
            expect(response.headers.get("Accept-Ranges")).toBe("bytes");
            expect(await response.text()).toBe("2345");
        });

        it("relays storage's 416 instead of reporting a storage failure", async () => {
            fetchFileMock.mockResolvedValue(
                new Response(null, { status: 416, headers: { "content-range": "bytes */10" } })
            );

            const response = await serveVideo({ Range: "bytes=50-" }, S3_FILE);

            expect(response.status).toBe(416);
            expect(response.headers.get("Content-Range")).toBe("bytes */10");
        });

        it("answers 200 when storage ignores the range", async () => {
            fetchFileMock.mockResolvedValue(
                new Response(BYTES, {
                    status: 200,
                    headers: { "content-type": "video/mp4", "content-length": "10" },
                })
            );

            const response = await serveVideo({ Range: "bytes=2-5" }, S3_FILE);

            expect(response.status).toBe(200);
            expect(response.headers.get("Content-Range")).toBeNull();
            expect(await response.text()).toBe(BYTES);
        });
    });
});
