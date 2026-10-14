/**
 * The legacy, id-addressed folder delete runs through ADR-014's folder rules
 * (`deleteFolderAs`): a folder the caller can't see reads as missing, and
 * deleting needs manage on it — no role gets past either.
 */
import type * as MockRequireWorkspaceContext from "../../helpers/mock-require-workspace-context";

import { DELETE } from "~/app/api/Categories/DeleteCategories/route";
import { FolderError } from "~/server/folders";
import { deleteFolderAs } from "~/server/workspace/folder-actions";

import { makeWorkspaceContext } from "../../helpers/workspace-context";

const mockRequireWorkspaceContext = jest.fn();
jest.mock("~/lib/require-workspace-context", () =>
    jest
        .requireActual<
            typeof MockRequireWorkspaceContext
        >("../../helpers/mock-require-workspace-context")
        .workspaceContextModuleMock(() => mockRequireWorkspaceContext())
);

jest.mock("~/server/workspace/folder-actions", () => ({ deleteFolderAs: jest.fn() }));

/** The id → path lookup; each test sets what it finds. */
let mockRows: { name: string }[] = [];
jest.mock("~/server/db/index", () => ({
    db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => mockRows }) }) }) },
}));

function mockCtx(role: string) {
    mockRequireWorkspaceContext.mockResolvedValue({
        success: true,
        data: makeWorkspaceContext({ role, companyId: BigInt(1), authUserId: "user-123" }),
    });
}

function request(body: unknown) {
    return new Request("http://localhost/api/Categories/DeleteCategories", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
}

beforeEach(() => {
    jest.clearAllMocks();
    mockRows = [];
});

describe("DELETE /api/Categories/DeleteCategories", () => {
    it("deletes the folder the id names, through the shared folder rules", async () => {
        mockCtx("member");
        mockRows = [{ name: "Plans" }];
        jest.mocked(deleteFolderAs).mockResolvedValue({
            path: "Plans",
            destination: "Unfiled",
            movedDocuments: 0,
            deletedFolders: 1,
        });

        const res = await DELETE(request({ id: 7 }));

        expect(res.status).toBe(200);
        expect(deleteFolderAs).toHaveBeenCalledWith(expect.anything(), "Plans");
    });

    it("answers 404 for an id outside the workspace", async () => {
        mockCtx("owner");
        const res = await DELETE(request({ id: 9 }));
        expect(res.status).toBe(404);
        expect(deleteFolderAs).not.toHaveBeenCalled();
    });

    it("answers 404, not 403, for a folder the caller can't see — even an admin", async () => {
        mockCtx("admin");
        mockRows = [{ name: "Someone's private folder" }];
        jest.mocked(deleteFolderAs).mockRejectedValue(
            new FolderError("folder_not_found", 404, "Folder not found.")
        );

        const res = await DELETE(request({ id: 28 }));

        expect(res.status).toBe(404);
        await expect(res.json()).resolves.toEqual({ error: "Category not found." });
    });

    it("refuses someone who doesn't manage the folder", async () => {
        mockCtx("member");
        mockRows = [{ name: "Sales" }];
        jest.mocked(deleteFolderAs).mockRejectedValue(
            new FolderError("forbidden", 403, "You do not manage this folder.")
        );

        const res = await DELETE(request({ id: 3 }));

        expect(res.status).toBe(403);
    });

    it("refuses a viewer outright", async () => {
        mockCtx("viewer");
        const res = await DELETE(request({ id: 3 }));
        expect(res.status).toBe(403);
        expect(deleteFolderAs).not.toHaveBeenCalled();
    });
});
