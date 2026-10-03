/**
 * The legacy folder create runs through ADR-014's folder rules
 * (`createFolderAs`): Members may create folders (they start private), a
 * Viewer may not.
 */
import type * as MockRequireWorkspaceContext from "../../helpers/mock-require-workspace-context";

import { POST } from "~/app/api/Categories/AddCategories/route";
import { FolderError } from "~/server/folders";
import { createFolderAs } from "~/server/workspace/folder-actions";

import { makeWorkspaceContext } from "../../helpers/workspace-context";

const mockRequireWorkspaceContext = jest.fn();
jest.mock("~/lib/require-workspace-context", () =>
    jest
        .requireActual<
            typeof MockRequireWorkspaceContext
        >("../../helpers/mock-require-workspace-context")
        .workspaceContextModuleMock(() => mockRequireWorkspaceContext())
);

jest.mock("~/server/workspace/folder-actions", () => ({ createFolderAs: jest.fn() }));

jest.mock("~/server/db/index", () => ({
    db: {
        select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ id: 41 }] }) }) }),
    },
}));

function mockCtx(role: string) {
    mockRequireWorkspaceContext.mockResolvedValue({
        success: true,
        data: makeWorkspaceContext({ role, companyId: BigInt(1), authUserId: "user-123" }),
    });
}

function request(body: unknown) {
    return new Request("http://localhost/api/Categories/AddCategories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
}

beforeEach(() => jest.clearAllMocks());

describe("POST /api/Categories/AddCategories", () => {
    it("lets a member create a folder, with ADR-014's defaults", async () => {
        mockCtx("member");
        jest.mocked(createFolderAs).mockResolvedValue({
            path: "Plans",
            created: ["Plans"],
            renamedTo: null,
        });

        const res = await POST(request({ CategoryName: "Plans" }));

        expect(res.status).toBe(200);
        expect(createFolderAs).toHaveBeenCalledWith(expect.anything(), "Plans");
        await expect(res.json()).resolves.toEqual({ success: true, id: { id: 41 }, name: "Plans" });
    });

    it("reports the name actually used when the asked one was taken", async () => {
        mockCtx("member");
        jest.mocked(createFolderAs).mockResolvedValue({
            path: "Notes (2)",
            created: ["Notes (2)"],
            renamedTo: "Notes (2)",
        });

        const res = await POST(request({ CategoryName: "Notes" }));

        await expect(res.json()).resolves.toMatchObject({ name: "Notes (2)" });
    });

    it("passes a refusal through with its status", async () => {
        mockCtx("member");
        jest.mocked(createFolderAs).mockRejectedValue(
            new FolderError("forbidden", 403, "You do not have edit access to that folder.")
        );

        const res = await POST(request({ CategoryName: "Board/Sub" }));

        expect(res.status).toBe(403);
    });

    it("refuses a viewer outright", async () => {
        mockCtx("viewer");
        const res = await POST(request({ CategoryName: "Plans" }));
        expect(res.status).toBe(403);
        expect(createFolderAs).not.toHaveBeenCalled();
    });

    it("rejects an empty name", async () => {
        mockCtx("member");
        const res = await POST(request({ CategoryName: "" }));
        expect(res.status).toBe(400);
    });
});
