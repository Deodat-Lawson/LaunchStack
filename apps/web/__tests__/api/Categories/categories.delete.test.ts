import type * as MockRequireWorkspaceContext from "../../helpers/mock-require-workspace-context";

import { DELETE } from "~/app/api/Categories/DeleteCategories/route";
import { validateRequestBody } from "~/lib/validation";
import { recordAuditEvent } from "~/lib/authz/audit";

import { makeWorkspaceContext } from "../../helpers/workspace-context";

const mockRequireWorkspaceContext = jest.fn();

jest.mock("~/lib/require-workspace-context", () =>
    jest
        .requireActual<
            typeof MockRequireWorkspaceContext
        >("../../helpers/mock-require-workspace-context")
        .workspaceContextModuleMock(() => mockRequireWorkspaceContext())
);

jest.mock("~/lib/validation", () => ({
    validateRequestBody: jest.fn(),
}));

jest.mock("~/lib/authz/audit", () => ({
    recordAuditEvent: jest.fn().mockResolvedValue(undefined),
}));

const mockDelete = jest.fn();
const mockTx = { delete: (...args: unknown[]) => mockDelete(...args) };

jest.mock("~/server/db/index", () => ({
    db: {
        transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(mockTx),
    },
}));

function mockCtx(role: string, companyId = BigInt(1)) {
    mockRequireWorkspaceContext.mockResolvedValue({
        success: true,
        data: makeWorkspaceContext({ role, companyId, authUserId: "user-123" }),
    });
}

function mockDeleteReturning(rows: { id: number; name: string }[]) {
    const returning = jest.fn().mockResolvedValue(rows);
    const where = jest.fn().mockReturnValue({ returning });
    mockDelete.mockReturnValue({ where });
    return { where, returning };
}

function request(body: unknown) {
    return new Request("http://localhost/api/Categories/DeleteCategory", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
}

describe("DELETE /api/Categories/DeleteCategory", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("should allow an authenticated owner to delete a category", async () => {
        (validateRequestBody as jest.Mock).mockResolvedValue({
            success: true,
            data: { id: 123 },
        });
        mockCtx("owner");
        const { where } = mockDeleteReturning([{ id: 123, name: "Legal" }]);

        const response = await DELETE(request({ id: 123 }));
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json.success).toBe(true);
        expect(where).toHaveBeenCalled();
        expect(recordAuditEvent).toHaveBeenCalledWith(
            mockTx,
            expect.objectContaining({
                action: "folder.deleted",
                targetType: "folder",
                targetId: 123,
                detail: { name: "Legal" },
            })
        );
    });

    it("should allow an authenticated admin to delete a category", async () => {
        (validateRequestBody as jest.Mock).mockResolvedValue({
            success: true,
            data: { id: 456 },
        });
        mockCtx("admin", BigInt(2));
        mockDeleteReturning([{ id: 456, name: "HR" }]);

        const response = await DELETE(request({ id: 456 }));
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json.success).toBe(true);
    });

    it("returns 401 when workspace context fails", async () => {
        (validateRequestBody as jest.Mock).mockResolvedValue({
            success: true,
            data: { id: 123 },
        });
        mockRequireWorkspaceContext.mockResolvedValue({
            success: false,
            response: new Response(JSON.stringify({ error: "Unauthorized" }), {
                status: 401,
                headers: { "Content-Type": "application/json" },
            }),
        });

        const response = await DELETE(request({ id: 123 }));
        const json = await response.json();

        expect(response.status).toBe(401);
        expect(json.error).toBe("Unauthorized");
    });

    it("should return 403 for a member (no folders.manage)", async () => {
        (validateRequestBody as jest.Mock).mockResolvedValue({
            success: true,
            data: { id: 123 },
        });
        mockCtx("member");

        const response = await DELETE(request({ id: 123 }));
        const json = await response.json();

        expect(response.status).toBe(403);
        expect(json.permission).toBe("folders.manage");
        expect(mockDelete).not.toHaveBeenCalled();
    });

    it("returns 404 when category is missing or outside company", async () => {
        (validateRequestBody as jest.Mock).mockResolvedValue({
            success: true,
            data: { id: 999 },
        });
        mockCtx("owner");
        mockDeleteReturning([]);

        const response = await DELETE(request({ id: 999 }));
        const json = await response.json();

        expect(response.status).toBe(404);
        expect(json.error).toBe("Category not found.");
        expect(recordAuditEvent).not.toHaveBeenCalled();
    });

    it("should return validation error if id is missing", async () => {
        (validateRequestBody as jest.Mock).mockResolvedValue({
            success: false,
            response: new Response(JSON.stringify({ error: "Category ID is required" }), {
                status: 400,
            }),
        });

        const response = await DELETE(request({ id: "" }));
        const json = await response.json();

        expect(response.status).toBe(400);
        expect(json.error).toBe("Category ID is required");
    });

    it("should return 500 on delete operation error", async () => {
        const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

        try {
            (validateRequestBody as jest.Mock).mockResolvedValue({
                success: true,
                data: { id: 123 },
            });
            mockCtx("owner");

            const returning = jest.fn().mockRejectedValue(new Error("Delete failed"));
            const where = jest.fn().mockReturnValue({ returning });
            mockDelete.mockReturnValue({ where });

            const response = await DELETE(request({ id: 123 }));
            expect(response.status).toBe(500);
        } finally {
            consoleErrorSpy.mockRestore();
        }
    });
});
