/**
 * POST /api/files — Create › File › Write it here. The route gates like
 * Create → Google Doc (documents.upload + edit access to the folder) and
 * gives the new file its creator's defaults; the service seeds and ingests
 * a Markdown file. Both are pinned here, with the service's own collaborators
 * mocked in the second block.
 */
import type * as MockRequireWorkspaceContext from "../../helpers/mock-require-workspace-context";

import { POST } from "~/app/api/files/route";
import { createMarkdownFile } from "~/server/services/file-editing/create";
import { canEditFolder } from "~/server/services/folder-access";
import { recordUpload } from "~/server/workspace/added-documents";

import { makeWorkspaceContext } from "../../helpers/workspace-context";

const mockRequireWorkspaceContext = jest.fn();

jest.mock("~/lib/require-workspace-context", () =>
    jest
        .requireActual<
            typeof MockRequireWorkspaceContext
        >("../../helpers/mock-require-workspace-context")
        .workspaceContextModuleMock(() => mockRequireWorkspaceContext())
);
jest.mock("~/lib/rate-limit-middleware", () => ({
    withRateLimit: (_request: Request, _config: unknown, handler: () => Promise<Response>) =>
        handler(),
}));
jest.mock("~/lib/rate-limiter", () => ({ RateLimitPresets: { strict: {} } }));
jest.mock("~/server/services/folder-access", () => ({ canEditFolder: jest.fn() }));
jest.mock("~/server/workspace/added-documents", () => ({ recordUpload: jest.fn() }));
jest.mock("~/server/services/file-editing/create", () => ({ createMarkdownFile: jest.fn() }));

const mockCreate = createMarkdownFile as jest.Mock;
const mockCanEditFolder = canEditFolder as jest.Mock;
const mockRecordUpload = recordUpload as jest.Mock;

const UPLOAD = {
    document: { id: 61, title: "Launch plan", url: "/api/files/3", category: "Strategy" },
    createdDocuments: [{ id: 61, title: "Launch plan", url: "/api/files/3", category: "Strategy" }],
};

function post(body: unknown, headers: Record<string, string> = {}) {
    return new Request("https://app.test/api/files", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
    });
}

beforeEach(() => {
    jest.clearAllMocks();
    mockRequireWorkspaceContext.mockResolvedValue({
        success: true,
        data: makeWorkspaceContext({ authUserId: "auth-1", companyId: BigInt(10) }),
    });
    mockCanEditFolder.mockResolvedValue(true);
    mockCreate.mockResolvedValue({ documentId: 61, title: "Launch plan", upload: UPLOAD });
});

describe("POST /api/files", () => {
    it("creates the file in the folder and gives it its creator's defaults", async () => {
        const res = await POST(post({ title: "  Launch plan ", folder: "Strategy" }));

        expect(res.status).toBe(201);
        expect(await res.json()).toEqual({ documentId: 61, title: "Launch plan" });
        expect(mockCreate).toHaveBeenCalledWith({
            companyId: BigInt(10),
            authUserId: "auth-1",
            title: "Launch plan",
            category: "Strategy",
            requestUrl: "https://app.test/api/files",
        });
        expect(mockRecordUpload).toHaveBeenCalledWith(
            expect.objectContaining({ authUserId: "auth-1" }),
            UPLOAD
        );
    });

    it("names a blank file in its creator's language and files it in Unfiled", async () => {
        await POST(post({ title: "   " }, { cookie: "ls-locale=zh-CN.1" }));
        expect(mockCreate).toHaveBeenCalledWith(
            expect.objectContaining({ title: "无标题文档", category: "Unfiled" })
        );
        expect(mockCanEditFolder).toHaveBeenCalledWith(expect.anything(), "Unfiled");
    });

    it("refuses a folder the caller cannot edit", async () => {
        mockCanEditFolder.mockResolvedValue(false);
        const res = await POST(post({ title: "x", folder: "Board" }));
        expect(res.status).toBe(403);
        expect(await res.json()).toEqual({
            error: "folder_denied",
            message: "You do not have edit access to this folder.",
        });
        expect(mockCreate).not.toHaveBeenCalled();
    });

    it("refuses someone without documents.upload", async () => {
        mockRequireWorkspaceContext.mockResolvedValue({
            success: true,
            data: makeWorkspaceContext({ permissions: ["documents.read"] }),
        });
        const res = await POST(post({ title: "x" }));
        expect(res.status).toBe(403);
        expect(mockCreate).not.toHaveBeenCalled();
    });

    it("refuses a title over 200 characters", async () => {
        const res = await POST(post({ title: "x".repeat(201) }));
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ error: "invalid_body" });
    });

    it("says so when creating fails", async () => {
        const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
        mockCreate.mockRejectedValue(new Error("storage down"));
        const res = await POST(post({ title: "x" }));
        expect(res.status).toBe(500);
        expect(await res.json()).toEqual({
            error: "create_failed",
            message: "The file couldn't be created. Try again.",
        });
        error.mockRestore();
    });
});
