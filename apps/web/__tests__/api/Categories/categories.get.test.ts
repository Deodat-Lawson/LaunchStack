import { GET } from "~/app/api/Categories/GetCategories/route";
import { db } from "~/server/db";

const mockRequireWorkspaceContext = jest.fn();

jest.mock("~/lib/require-workspace-context", () => ({
    ...jest.requireActual("~/lib/require-workspace-context"),
    requireWorkspaceContext: () => mockRequireWorkspaceContext(),
}));

jest.mock("~/server/db", () => ({
    db: {
        select: jest.fn(),
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

function mockCategories(rows: { id: number; name: string; companyId: number }[]) {
    (db.select as jest.Mock).mockReturnValue({
        from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue(rows),
        }),
    });
}

describe("GET /api/Categories/GetCategories", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("allows an owner to get categories", async () => {
        mockCtx("owner");
        const rows = [
            { id: 1, name: "Category 1", companyId: 1 },
            { id: 2, name: "Category 2", companyId: 1 },
        ];
        mockCategories(rows);

        const response = await GET(new Request("http://localhost/api/Categories/GetCategories"));
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json).toEqual(rows);
    });

    it("allows an admin to get categories", async () => {
        mockCtx("admin", BigInt(2));
        const rows = [{ id: 10, name: "Owner Category", companyId: 2 }];
        mockCategories(rows);

        const response = await GET(new Request("http://localhost/api/Categories/GetCategories"));

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual(rows);
    });

    it("returns an empty array when the company has no categories", async () => {
        mockCtx("owner");
        mockCategories([]);

        const response = await GET(new Request("http://localhost/api/Categories/GetCategories"));

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual([]);
    });

    it("returns 401 when workspace context fails", async () => {
        mockRequireWorkspaceContext.mockResolvedValue({
            success: false,
            response: new Response(JSON.stringify({ error: "Unauthorized" }), {
                status: 401,
            }),
        });

        const response = await GET(new Request("http://localhost/api/Categories/GetCategories"));

        expect(response.status).toBe(401);
    });

    it("returns 403 for an editor", async () => {
        mockCtx("editor");

        const response = await GET(new Request("http://localhost/api/Categories/GetCategories"));
        const json = await response.json();

        expect(response.status).toBe(403);
        expect(json.error).toBe("Invalid user role.");
        expect(db.select).not.toHaveBeenCalled();
    });

    it("returns 500 on database error", async () => {
        mockCtx("owner");
        (db.select as jest.Mock).mockReturnValue({
            from: jest.fn().mockReturnValue({
                where: jest.fn().mockRejectedValue(new Error("db down")),
            }),
        });

        const response = await GET(new Request("http://localhost/api/Categories/GetCategories"));

        expect(response.status).toBe(500);
    });
});
