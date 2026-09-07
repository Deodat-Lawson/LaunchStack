import type * as MockRequireWorkspaceContext from "../../helpers/mock-require-workspace-context";

import { POST } from "~/app/api/Categories/AddCategories/route";
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

const mockInsert = jest.fn();
const mockTx = { insert: (...args: unknown[]) => mockInsert(...args) };

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

function mockInsertReturning(rows: { id: number }[]) {
    mockInsert.mockReturnValue({
        values: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue(rows),
        }),
    });
}

function request(body: unknown) {
    return new Request("http://localhost/api/Categories/AddCategories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
}

describe("POST /api/Categories/AddCategories", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("allows an owner to create a category and records the audit event", async () => {
        (validateRequestBody as jest.Mock).mockResolvedValue({
            success: true,
            data: { CategoryName: "Test Category" },
        });
        mockCtx("owner");
        mockInsertReturning([{ id: 1 }]);

        const response = await POST(request({ CategoryName: "Test Category" }));
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json.success).toBe(true);
        expect(json.name).toBe("Test Category");
        expect(recordAuditEvent).toHaveBeenCalledWith(
            mockTx,
            expect.objectContaining({
                companyId: BigInt(1),
                actorUserId: "user-123",
                action: "folder.created",
                targetType: "folder",
                targetId: 1,
                detail: { name: "Test Category" },
            })
        );
    });

    it("allows an admin to create a category", async () => {
        (validateRequestBody as jest.Mock).mockResolvedValue({
            success: true,
            data: { CategoryName: "Admin Category" },
        });
        mockCtx("admin");
        mockInsertReturning([{ id: 2 }]);

        const response = await POST(request({ CategoryName: "Admin Category" }));

        expect(response.status).toBe(200);
    });

    it("returns 403 for a member (no folders.manage)", async () => {
        (validateRequestBody as jest.Mock).mockResolvedValue({
            success: true,
            data: { CategoryName: "Test Category" },
        });
        mockCtx("member");

        const response = await POST(request({ CategoryName: "Test Category" }));
        const json = await response.json();

        expect(response.status).toBe(403);
        expect(json.permission).toBe("folders.manage");
        expect(mockInsert).not.toHaveBeenCalled();
    });

    it("returns 401 when workspace context fails", async () => {
        (validateRequestBody as jest.Mock).mockResolvedValue({
            success: true,
            data: { CategoryName: "Test Category" },
        });
        mockRequireWorkspaceContext.mockResolvedValue({
            success: false,
            response: new Response(JSON.stringify({ error: "Unauthorized" }), {
                status: 401,
            }),
        });

        const response = await POST(request({ CategoryName: "Test Category" }));

        expect(response.status).toBe(401);
    });

    it("returns validation error when CategoryName is invalid", async () => {
        (validateRequestBody as jest.Mock).mockResolvedValue({
            success: false,
            response: new Response(JSON.stringify({ error: "Category name is required" }), {
                status: 400,
            }),
        });

        const response = await POST(request({ CategoryName: "" }));

        expect(response.status).toBe(400);
    });
});
