import { POST } from "~/app/api/Categories/AddCategories/route";
import { validateRequestBody } from "~/lib/validation";
import { db } from "~/server/db/index";

const mockRequireWorkspaceContext = jest.fn();

jest.mock("~/lib/require-workspace-context", () => ({
    ...jest.requireActual("~/lib/require-workspace-context"),
    requireWorkspaceContext: () => mockRequireWorkspaceContext(),
}));

jest.mock("~/lib/validation", () => ({
    validateRequestBody: jest.fn(),
}));

jest.mock("~/server/db/index", () => ({
    db: {
        insert: jest.fn(),
    },
}));

function mockCtx(role: string, companyId = BigInt(1)) {
    mockRequireWorkspaceContext.mockResolvedValue({
        success: true,
        data: {
            clerkUserId: "user-123",
            userPk: BigInt(7),
            companyId,
            role,
            status: "verified",
        },
    });
}

describe("POST /api/Categories/AddCategories", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("allows an owner to create a category", async () => {
        (validateRequestBody as jest.Mock).mockResolvedValue({
            success: true,
            data: { CategoryName: "Test Category" },
        });
        mockCtx("owner");
        (db.insert as jest.Mock).mockReturnValue({
            values: jest.fn().mockReturnValue({
                returning: jest.fn().mockResolvedValue([{ id: 1 }]),
            }),
        });

        const response = await POST(
            new Request("http://localhost/api/Categories/AddCategories", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ CategoryName: "Test Category" }),
            })
        );
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json.success).toBe(true);
        expect(json.name).toBe("Test Category");
    });

    it("allows an admin to create a category", async () => {
        (validateRequestBody as jest.Mock).mockResolvedValue({
            success: true,
            data: { CategoryName: "Admin Category" },
        });
        mockCtx("admin");
        (db.insert as jest.Mock).mockReturnValue({
            values: jest.fn().mockReturnValue({
                returning: jest.fn().mockResolvedValue([{ id: 2 }]),
            }),
        });

        const response = await POST(
            new Request("http://localhost/api/Categories/AddCategories", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ CategoryName: "Admin Category" }),
            })
        );

        expect(response.status).toBe(200);
    });

    it("returns 403 for an editor", async () => {
        (validateRequestBody as jest.Mock).mockResolvedValue({
            success: true,
            data: { CategoryName: "Test Category" },
        });
        mockCtx("editor");

        const response = await POST(
            new Request("http://localhost/api/Categories/AddCategories", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ CategoryName: "Test Category" }),
            })
        );
        const json = await response.json();

        expect(response.status).toBe(403);
        expect(json.error).toBe("Invalid user role.");
        expect(db.insert).not.toHaveBeenCalled();
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

        const response = await POST(
            new Request("http://localhost/api/Categories/AddCategories", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ CategoryName: "Test Category" }),
            })
        );

        expect(response.status).toBe(401);
    });

    it("returns validation error when CategoryName is invalid", async () => {
        (validateRequestBody as jest.Mock).mockResolvedValue({
            success: false,
            response: new Response(JSON.stringify({ error: "Category name is required" }), {
                status: 400,
            }),
        });

        const response = await POST(
            new Request("http://localhost/api/Categories/AddCategories", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ CategoryName: "" }),
            })
        );

        expect(response.status).toBe(400);
    });
});
