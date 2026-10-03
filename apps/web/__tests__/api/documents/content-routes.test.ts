/**
 * The routes that proxy a document's stored bytes, like /api/files. The type
 * storage reports is the uploader's claim, so anything a browser could execute
 * goes out sandboxed and a PDF does not.
 */

import type * as MockRequireWorkspaceContext from "../../helpers/mock-require-workspace-context";

import { GET as getContent } from "~/app/api/documents/[id]/content/route";
import { GET as getVersionContent } from "~/app/api/documents/[id]/versions/[versionId]/content/route";
import { fetchFile } from "~/lib/storage";

import { makeWorkspaceContext } from "../../helpers/workspace-context";

const mockRequireWorkspaceContext = jest.fn();

jest.mock("~/lib/require-workspace-context", () =>
    jest
        .requireActual<
            typeof MockRequireWorkspaceContext
        >("../../helpers/mock-require-workspace-context")
        .workspaceContextModuleMock(() => mockRequireWorkspaceContext())
);

// The scope predicate has its own tests; here it only feeds the fake `where`.
jest.mock("~/lib/authz/scope", () => ({
    scopedDocumentWhere: () => ({}),
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

// Each route proxies (rather than redirects) under a different backend: the
// document route for S3, the version route for database storage.
jest.mock("~/lib/storage", () => ({
    fetchFile: jest.fn(),
    isS3Storage: () => true,
    isLocalStorage: () => true,
}));

const fetchFileMock = jest.mocked(fetchFile);
const SCRIPT = "<script>fetch('/api/me', { credentials: 'include' })</script>";

/** One result per `db.select().from().where()` the route makes, in order. */
function selectReturns(...results: Record<string, unknown>[][]) {
    for (const result of results) {
        const where = jest.fn().mockResolvedValue(result);
        mockDbSelect.mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where }) });
    }
}

function storageReturns(body: string, type: string) {
    fetchFileMock.mockResolvedValue(new Response(body, { headers: { "content-type": type } }));
}

beforeEach(() => {
    jest.clearAllMocks();
    mockRequireWorkspaceContext.mockResolvedValue({ success: true, data: makeWorkspaceContext() });
});

describe("GET /api/documents/[id]/content", () => {
    const get = () =>
        getContent(new Request("http://localhost/api/documents/5/content"), {
            params: Promise.resolve({ id: "5" }),
        });

    it("sandboxes an HTML document so its scripts cannot run on this origin", async () => {
        selectReturns([{ url: "https://s3.example.test/documents/abc", title: "page.html" }]);
        storageReturns(SCRIPT, "text/html");

        const response = await get();

        expect(response.status).toBe(200);
        expect(response.headers.get("Content-Security-Policy")).toBe("sandbox");
        expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
        expect(response.headers.get("Content-Type")).toBe("text/html");
        expect(await response.text()).toBe(SCRIPT);
    });

    it("serves a PDF outside the sandbox", async () => {
        selectReturns([{ url: "https://s3.example.test/documents/abc", title: "report.pdf" }]);
        storageReturns("%PDF-1.7", "application/pdf");

        const response = await get();

        expect(response.headers.get("Content-Security-Policy")).toBeNull();
        expect(response.headers.get("Content-Type")).toBe("application/pdf");
    });
});

describe("GET /api/documents/[id]/versions/[versionId]/content", () => {
    const get = () =>
        getVersionContent(new Request("http://localhost/api/documents/5/versions/9/content"), {
            params: Promise.resolve({ id: "5", versionId: "9" }),
        });

    it("sandboxes a version recorded as HTML, whatever storage reports", async () => {
        selectReturns(
            [{ companyId: BigInt(5), title: "Page" }],
            [{ url: "/api/files/41", mimeType: "text/html", versionNumber: 2 }]
        );
        storageReturns(SCRIPT, "application/pdf");

        const response = await get();

        expect(response.status).toBe(200);
        expect(response.headers.get("Content-Security-Policy")).toBe("sandbox");
        expect(response.headers.get("Content-Type")).toBe("text/html");
    });

    it("serves a PDF version outside the sandbox", async () => {
        selectReturns(
            [{ companyId: BigInt(5), title: "Report" }],
            [{ url: "/api/files/41", mimeType: "application/pdf", versionNumber: 2 }]
        );
        storageReturns("%PDF-1.7", "application/pdf");

        const response = await get();

        expect(response.headers.get("Content-Security-Policy")).toBeNull();
        expect(response.headers.get("Content-Type")).toBe("application/pdf");
    });
});
