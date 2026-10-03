/**
 * The legacy, id-addressed folder rename runs through ADR-014's folder rules
 * (`renameFolderAs`): visible to the caller, managed by them, and a move never
 * publishes.
 */
import type * as MockRequireWorkspaceContext from "../../helpers/mock-require-workspace-context";

import { PATCH } from "~/app/api/Categories/[id]/route";
import { FolderError } from "~/server/folders";
import { renameFolderAs } from "~/server/workspace/folder-actions";

import { makeWorkspaceContext } from "../../helpers/workspace-context";

const mockRequireWorkspaceContext = jest.fn();
jest.mock("~/lib/require-workspace-context", () =>
    jest
        .requireActual<
            typeof MockRequireWorkspaceContext
        >("../../helpers/mock-require-workspace-context")
        .workspaceContextModuleMock(() => mockRequireWorkspaceContext())
);

jest.mock("~/server/workspace/folder-actions", () => ({ renameFolderAs: jest.fn() }));

let mockRows: { name: string }[] = [];
jest.mock("~/server/db", () => ({
    db: { select: () => ({ from: () => ({ where: async () => mockRows }) }) },
}));

function mockCtx(role: string) {
    mockRequireWorkspaceContext.mockResolvedValue({
        success: true,
        data: makeWorkspaceContext({ role, companyId: BigInt(1), authUserId: "user-123" }),
    });
}

const patch = (id: string, name: string) =>
    PATCH(
        new Request(`http://localhost/api/Categories/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name }),
        }),
        { params: Promise.resolve({ id }) }
    );

beforeEach(() => {
    jest.clearAllMocks();
    mockRows = [];
});

describe("PATCH /api/Categories/[id]", () => {
    it("renames through the shared folder rules", async () => {
        mockCtx("member");
        mockRows = [{ name: "Plans" }];
        jest.mocked(renameFolderAs).mockResolvedValue({
            from: "Plans",
            to: "Roadmap",
            movedDocuments: 0,
            renamedFolders: 1,
            access: "unchanged",
        });

        const res = await patch("7", "Roadmap");

        expect(res.status).toBe(200);
        expect(renameFolderAs).toHaveBeenCalledWith(expect.anything(), "Plans", "Roadmap");
    });

    it("answers 404 for a folder an admin can't see", async () => {
        mockCtx("admin");
        mockRows = [{ name: "Private" }];
        jest.mocked(renameFolderAs).mockRejectedValue(
            new FolderError("folder_not_found", 404, "Folder not found.")
        );

        const res = await patch("29", "Exposed");

        expect(res.status).toBe(404);
    });

    it("answers 404 for an id outside the workspace", async () => {
        mockCtx("owner");
        const res = await patch("99", "X");
        expect(res.status).toBe(404);
        expect(renameFolderAs).not.toHaveBeenCalled();
    });
});
