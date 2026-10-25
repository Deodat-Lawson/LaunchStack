/**
 * /api/documents/adeu/apply: the edited Word file is stored as a new upload
 * and the document is repointed at it.
 *
 * The contract under test: that upload is stamped with the document's
 * workspace. /api/files/[id] denies every session read of an unstamped
 * file_uploads row, so without the stamp the edited document's raw file
 * 404s for everyone on database storage.
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
const mockUploadFile = jest.fn();

jest.mock("~/lib/storage", () => ({
    fetchFile: (url: string) => mockFetchFile(url),
    uploadFile: (input: unknown) => mockUploadFile(input),
}));

const mockAcceptAllChanges = jest.fn();
const mockRejectAllChanges = jest.fn();
const mockProcessDocumentBatchDetailed = jest.fn();

jest.mock("@launchstack/editing", () => ({
    acceptAllChanges: (bytes: Buffer) => mockAcceptAllChanges(bytes),
    rejectAllChanges: (bytes: Buffer) => mockRejectAllChanges(bytes),
    processDocumentBatchDetailed: (...args: unknown[]) => mockProcessDocumentBatchDetailed(...args),
}));

const mockGetActiveDriveLink = jest.fn();

jest.mock("~/server/services/google-drive/links", () => ({
    getActiveDriveLink: (documentId: number) => mockGetActiveDriveLink(documentId),
}));

// FIFO-queue db mock: each select() resolves the next queued result no
// matter how the drizzle builder chain is shaped.
const mockSelectQueue: unknown[][] = [];
const mockUpdateSet = jest.fn();

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
    db: {
        select: () => mockSelectBuilder(),
        update: () => ({
            set: (values: unknown) => {
                mockUpdateSet(values);
                return { where: () => Promise.resolve([]) };
            },
        }),
    },
}));

import { POST } from "~/app/api/documents/adeu/apply/route";

import { makeWorkspaceContext } from "../../helpers/workspace-context";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function request(body: Record<string, unknown>): Request {
    return new Request("http://localhost/api/documents/adeu/apply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    });
}

beforeEach(() => {
    jest.clearAllMocks();
    mockSelectQueue.length = 0;

    mockRequireWorkspaceContext.mockResolvedValue({
        success: true,
        data: makeWorkspaceContext({ companyId: BigInt(42), authUserId: "user_1" }),
    });
    mockSelectQueue.push([
        {
            id: 7,
            title: "Contract.docx",
            url: "/api/files/100",
            companyId: BigInt(42),
            mimeType: DOCX_MIME,
            fileType: "docx",
        },
    ]);
    mockFetchFile.mockResolvedValue(new Response(Buffer.from("PK original"), { status: 200 }));
    mockGetActiveDriveLink.mockResolvedValue(null);
    mockUploadFile.mockResolvedValue({
        url: "/api/files/101",
        pathname: "101",
        contentType: DOCX_MIME,
        provider: "database",
    });
});

describe("POST /api/documents/adeu/apply", () => {
    it("stamps the document's workspace on the upload after accept-all", async () => {
        mockAcceptAllChanges.mockResolvedValue(new Blob([Buffer.from("PK accepted")]));

        const res = await POST(request({ documentId: 7, resolveAll: "accept" }));

        expect(res.status).toBe(200);
        expect(mockUploadFile).toHaveBeenCalledTimes(1);
        expect(mockUploadFile).toHaveBeenCalledWith(
            expect.objectContaining({
                filename: "Contract.docx",
                contentType: DOCX_MIME,
                userId: "user_1",
                companyId: BigInt(42),
            })
        );
        expect(mockUpdateSet).toHaveBeenCalledWith(
            expect.objectContaining({ url: "/api/files/101" })
        );
    });

    it("stamps the document's workspace on the upload after tracked edits", async () => {
        mockProcessDocumentBatchDetailed.mockResolvedValue({
            document_base64: Buffer.from("PK edited").toString("base64"),
            result: { applied: 1, skipped: 0 },
        });

        const res = await POST(
            request({ documentId: 7, edits: [{ target_text: "old", new_text: "new" }] })
        );

        expect(res.status).toBe(200);
        expect(mockUploadFile).toHaveBeenCalledWith(
            expect.objectContaining({ companyId: BigInt(42) })
        );
    });
});
