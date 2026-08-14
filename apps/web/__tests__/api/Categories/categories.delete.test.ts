import { DELETE } from "~/app/api/Categories/DeleteCategories/route";
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
    delete: jest.fn(),
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

function mockDeleteReturning(rows: { id: number }[]) {
  const returning = jest.fn().mockResolvedValue(rows);
  const where = jest.fn().mockReturnValue({ returning });
  (db.delete as jest.Mock).mockReturnValue({ where });
  return { where, returning };
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
    const { where } = mockDeleteReturning([{ id: 123 }]);

    const request = new Request(
      "http://localhost/api/Categories/DeleteCategory",
      {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: 123 }),
      },
    );

    const response = await DELETE(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(where).toHaveBeenCalled();
  });

  it("should allow an authenticated admin to delete a category", async () => {
    (validateRequestBody as jest.Mock).mockResolvedValue({
      success: true,
      data: { id: 456 },
    });
    mockCtx("admin", BigInt(2));
    mockDeleteReturning([{ id: 456 }]);

    const request = new Request(
      "http://localhost/api/Categories/DeleteCategory",
      {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: 456 }),
      },
    );

    const response = await DELETE(request);
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

    const request = new Request(
      "http://localhost/api/Categories/DeleteCategory",
      {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: 123 }),
      },
    );

    const response = await DELETE(request);
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json.error).toBe("Unauthorized");
  });

  it("should return 403 if user has an editor role", async () => {
    (validateRequestBody as jest.Mock).mockResolvedValue({
      success: true,
      data: { id: 123 },
    });
    mockCtx("editor");

    const request = new Request(
      "http://localhost/api/Categories/DeleteCategory",
      {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: 123 }),
      },
    );

    const response = await DELETE(request);
    const json = await response.json();

    expect(response.status).toBe(403);
    expect(json.error).toBe("Invalid user role.");
  });

  it("returns 404 when category is missing or outside company", async () => {
    (validateRequestBody as jest.Mock).mockResolvedValue({
      success: true,
      data: { id: 999 },
    });
    mockCtx("owner");
    mockDeleteReturning([]);

    const request = new Request(
      "http://localhost/api/Categories/DeleteCategory",
      {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: 999 }),
      },
    );

    const response = await DELETE(request);
    const json = await response.json();

    expect(response.status).toBe(404);
    expect(json.error).toBe("Category not found.");
  });

  it("should return validation error if id is missing", async () => {
    (validateRequestBody as jest.Mock).mockResolvedValue({
      success: false,
      response: new Response(
        JSON.stringify({ error: "Category ID is required" }),
        { status: 400 },
      ),
    });

    const request = new Request(
      "http://localhost/api/Categories/DeleteCategory",
      {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "" }),
      },
    );

    const response = await DELETE(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toBe("Category ID is required");
  });

  it("should return 500 on delete operation error", async () => {
    const consoleErrorSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});

    try {
      (validateRequestBody as jest.Mock).mockResolvedValue({
        success: true,
        data: { id: 123 },
      });
      mockCtx("owner");

      const returning = jest
        .fn()
        .mockRejectedValue(new Error("Delete failed"));
      const where = jest.fn().mockReturnValue({ returning });
      (db.delete as jest.Mock).mockReturnValue({ where });

      const request = new Request(
        "http://localhost/api/Categories/DeleteCategory",
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: 123 }),
        },
      );

      const response = await DELETE(request);
      expect(response.status).toBe(500);
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});
