/**
 * The folders route is auth, the ADR-014 gates on writes (anyone who can add
 * sources creates; a subfolder needs edit on its parent; rename / move /
 * delete need manage on the folder), body validation, and the mapping of
 * expected outcomes (not found, already exists) to their statuses.
 */

import type { NextResponse } from "next/server";

import { DELETE, GET, PATCH, POST } from "~/app/api/folders/route";
import type { WorkspaceContext } from "~/lib/require-workspace-context";
import { createFolder, deleteFolder, listVisibleFolders, renameFolder } from "~/server/folders";
import { makeWorkspaceContext } from "../helpers/workspace-context";

const mockRequireWorkspaceContext = jest.fn();
jest.mock("~/lib/require-workspace-context", () =>
    jest
        .requireActual("../helpers/mock-require-workspace-context")
        .workspaceContextModuleMock(() => mockRequireWorkspaceContext())
);

jest.mock("~/server/folders", () => ({
    listVisibleFolders: jest.fn(),
    createFolder: jest.fn(),
    renameFolder: jest.fn(),
    deleteFolder: jest.fn(),
}));

const mockCanEdit = jest.fn();
const mockCanManage = jest.fn();
jest.mock("~/server/workspace/item-access", () => ({
    canEditFolderPath: (...args: unknown[]) => mockCanEdit(...args),
    canManageFolderPath: (...args: unknown[]) => mockCanManage(...args),
    folderAccess: jest.fn().mockResolvedValue({ audience: "workspace" }),
}));
jest.mock("~/server/workspace/ownership", () => ({
    applyFolderCreationDefaults: jest.fn().mockResolvedValue(undefined),
    carryRestrictionsBeforeFolderDelete: jest.fn().mockResolvedValue(0),
}));
jest.mock("~/server/workspace/activity", () => ({
    recordActivity: jest.fn().mockResolvedValue(undefined),
}));

// Writes land in the audit log through the shared client; neither is under test here.
jest.mock("~/lib/authz/audit", () => ({
    recordAuditEvent: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("~/server/db", () => ({ db: {} }));

jest.mock("~/lib/rate-limit-middleware", () => ({
    withRateLimit: (_request: Request, _config: unknown, handler: () => Promise<NextResponse>) =>
        handler(),
}));

function ctx(role: string): WorkspaceContext {
    return makeWorkspaceContext({
        authUserId: "user_1",
        userPk: BigInt(1),
        companyId: BigInt(42),
        role,
    });
}

function request(method: string, body?: unknown): Request {
    return new Request("http://localhost/api/folders", {
        method,
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
}

function expectedOutcome(code: string, status: number, message: string) {
    return Object.assign(new Error(message), { code, status });
}

beforeEach(() => {
    mockRequireWorkspaceContext.mockReset();
    jest.mocked(listVisibleFolders).mockReset();
    jest.mocked(createFolder).mockReset();
    jest.mocked(renameFolder).mockReset();
    jest.mocked(deleteFolder).mockReset();
    mockCanEdit.mockReset().mockResolvedValue(true);
    mockCanManage.mockReset().mockResolvedValue(true);
});

describe("/api/folders", () => {
    it("lists folders for any verified member", async () => {
        mockRequireWorkspaceContext.mockResolvedValue({
            success: true,
            data: ctx("employee"),
        });
        jest.mocked(listVisibleFolders).mockResolvedValue([
            {
                path: "Contracts",
                documentCount: 2,
                persisted: true,
                categoryId: 7,
                restricted: false,
            },
        ]);

        const response = await GET(request("GET"));

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({
            success: true,
            data: {
                folders: [
                    {
                        path: "Contracts",
                        documentCount: 2,
                        persisted: true,
                        categoryId: 7,
                        restricted: false,
                    },
                ],
            },
        });
        expect(listVisibleFolders).toHaveBeenCalledWith(BigInt(42), { kind: "everything" });
    });

    it("refuses folder writes from someone who cannot add sources", async () => {
        mockRequireWorkspaceContext.mockResolvedValue({
            success: true,
            data: ctx("viewer"),
        });

        const response = await POST(request("POST", { path: "Contracts" }));

        expect(response.status).toBe(403);
        expect(createFolder).not.toHaveBeenCalled();
    });

    it("lets a member create a top-level folder (it starts private to them)", async () => {
        mockRequireWorkspaceContext.mockResolvedValue({
            success: true,
            data: ctx("member"),
        });
        jest.mocked(createFolder).mockResolvedValue({ path: "Plans", created: ["Plans"] });

        const response = await POST(request("POST", { path: "Plans" }));

        expect(response.status).toBe(201);
        expect(createFolder).toHaveBeenCalledWith(BigInt(42), "Plans", expect.any(Function));
        // No parent to check.
        expect(mockCanEdit).not.toHaveBeenCalled();
    });

    it("needs edit access to the parent to create a subfolder", async () => {
        mockRequireWorkspaceContext.mockResolvedValue({
            success: true,
            data: ctx("member"),
        });
        mockCanEdit.mockResolvedValue(false);

        const response = await POST(request("POST", { path: "Contracts/2026" }));

        expect(response.status).toBe(403);
        expect(mockCanEdit).toHaveBeenCalledWith(expect.anything(), "Contracts");
        expect(createFolder).not.toHaveBeenCalled();
    });

    it("creates a subfolder and reports what was added", async () => {
        mockRequireWorkspaceContext.mockResolvedValue({
            success: true,
            data: ctx("owner"),
        });
        jest.mocked(createFolder).mockResolvedValue({
            path: "Contracts/2026",
            created: ["Contracts/2026"],
        });

        const response = await POST(request("POST", { path: "Contracts/2026" }));

        expect(response.status).toBe(201);
        expect(createFolder).toHaveBeenCalledWith(
            BigInt(42),
            "Contracts/2026",
            expect.any(Function)
        );
    });

    it("refuses a rename without manage access to the folder", async () => {
        mockRequireWorkspaceContext.mockResolvedValue({
            success: true,
            data: ctx("member"),
        });
        mockCanManage.mockResolvedValue(false);

        const response = await PATCH(request("PATCH", { path: "Contracts", newPath: "Deals" }));

        expect(response.status).toBe(403);
        expect(renameFolder).not.toHaveBeenCalled();
    });

    it("needs edit access to the destination when moving a folder", async () => {
        mockRequireWorkspaceContext.mockResolvedValue({
            success: true,
            data: ctx("member"),
        });
        mockCanEdit.mockResolvedValue(false);

        const response = await PATCH(
            request("PATCH", { path: "Contracts", newPath: "Finance/Contracts" })
        );

        expect(response.status).toBe(403);
        expect(mockCanEdit).toHaveBeenCalledWith(expect.anything(), "Finance");
        expect(renameFolder).not.toHaveBeenCalled();
    });

    it("refuses a delete without manage access to the folder", async () => {
        mockRequireWorkspaceContext.mockResolvedValue({
            success: true,
            data: ctx("admin"),
        });
        mockCanManage.mockResolvedValue(false);

        const response = await DELETE(request("DELETE", { path: "Board" }));

        expect(response.status).toBe(403);
        expect(deleteFolder).not.toHaveBeenCalled();
    });

    it("rejects a rename without both paths", async () => {
        mockRequireWorkspaceContext.mockResolvedValue({
            success: true,
            data: ctx("admin"),
        });

        const response = await PATCH(request("PATCH", { path: "Contracts" }));

        expect(response.status).toBe(400);
        expect(renameFolder).not.toHaveBeenCalled();
    });

    it("reports an expected outcome with its own status", async () => {
        mockRequireWorkspaceContext.mockResolvedValue({
            success: true,
            data: ctx("admin"),
        });
        jest.mocked(renameFolder).mockRejectedValue(
            expectedOutcome("folder_exists", 409, 'A folder named "HR" already exists there.')
        );
        // Same parent (top level), so only manage on the folder is checked.

        const response = await PATCH(request("PATCH", { path: "Contracts", newPath: "HR" }));

        expect(response.status).toBe(409);
        await expect(response.json()).resolves.toEqual({
            success: false,
            message: 'A folder named "HR" already exists there.',
            code: "folder_exists",
        });
    });

    it("deletes a folder and says where its sources went", async () => {
        mockRequireWorkspaceContext.mockResolvedValue({
            success: true,
            data: ctx("owner"),
        });
        jest.mocked(deleteFolder).mockResolvedValue({
            path: "Contracts/2026",
            destination: "Contracts",
            movedDocuments: 3,
            deletedFolders: 2,
        });

        const response = await DELETE(request("DELETE", { path: "Contracts/2026" }));

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toMatchObject({
            success: true,
            data: { destination: "Contracts", movedDocuments: 3 },
        });
    });

    it("never leaks an unexpected failure", async () => {
        mockRequireWorkspaceContext.mockResolvedValue({
            success: true,
            data: ctx("owner"),
        });
        jest.mocked(deleteFolder).mockRejectedValue(new Error("pg: deadlock detected"));
        const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);

        const response = await DELETE(request("DELETE", { path: "Contracts" }));

        expect(response.status).toBe(500);
        const body = (await response.json()) as { message: string };
        expect(body.message).toBe("Request failed");
        consoleError.mockRestore();
    });
});
