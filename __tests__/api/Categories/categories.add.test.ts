import { POST } from "~/app/api/Categories/AddCategories/route";
import { auth } from "~/lib/auth-server";
import { validateRequestBody } from "~/lib/validation";
import { db } from "~/server/db/index";

jest.mock("~/lib/auth-server", () => ({
  auth: jest.fn(),
}));

jest.mock("~/lib/validation", () => ({
  validateRequestBody: jest.fn(),
}));

jest.mock("~/server/db/index", () => ({
  db: {
    select: jest.fn(),
    insert: jest.fn(),
  },
}));

describe("POST /api/Categories/AddCategories", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should allow an authenticated employer to create a category", async () => {
    // Mock successful validation
    (validateRequestBody as jest.Mock).mockResolvedValue({
      success: true,
      data: { CategoryName: "Test Category" },
    });

    // Mock authenticated user
    (auth as jest.Mock).mockResolvedValue({ userId: "test-user-123" });

    // Mock database select (user lookup) - return employer user
    const mockSelect = jest.fn().mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue([
          { userId: "test-user-123", role: "employer", companyId: 1 }
        ]),
      }),
    });
    (db.select as jest.Mock) = mockSelect;

    // Mock database insert (category creation)
    const mockInsert = jest.fn().mockReturnValue({
      values: jest.fn().mockReturnValue({
        returning: jest.fn().mockResolvedValue([{ id: 1 }]),
      }),
    });
    (db.insert as jest.Mock) = mockInsert;

    const request = new Request("http://localhost/api/Categories/AddCategories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ CategoryName: "Test Category" }),
    });

    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.name).toBe("Test Category");
    expect(json.id).toEqual({ id: 1 });
  });

  it("should allow an authenticated owner to create a category", async () => {
    (validateRequestBody as jest.Mock).mockResolvedValue({
      success: true,
      data: { CategoryName: "Owner Category" },
    });

    (auth as jest.Mock).mockResolvedValue({ userId: "owner-user-456" });

    // Mock database select - return owner user
    const mockSelect = jest.fn().mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue([
          { userId: "owner-user-456", role: "owner", companyId: 2 }
        ]),
      }),
    });
    (db.select as jest.Mock) = mockSelect;

    const mockInsert = jest.fn().mockReturnValue({
      values: jest.fn().mockReturnValue({
        returning: jest.fn().mockResolvedValue([{ id: 2 }]),
      }),
    });
    (db.insert as jest.Mock) = mockInsert;

    const request = new Request("http://localhost/api/Categories/AddCategories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ CategoryName: "Owner Category" }),
    });

    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.name).toBe("Owner Category");
  });

  it("should return 400 if user is not found (invalid userId)", async () => {
    (validateRequestBody as jest.Mock).mockResolvedValue({
      success: true,
      data: { CategoryName: "Test Category" },
    });

    (auth as jest.Mock).mockResolvedValue({ userId: "invalid-user-999" });

    const mockSelect = jest.fn().mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue([]),
      }),
    });
    (db.select as jest.Mock) = mockSelect;

    const request = new Request("http://localhost/api/Categories/AddCategories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ CategoryName: "Test Category" }),
    });

    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toBe("Invalid user.");
  });

  it("should return 400 if user has invalid role (employee)", async () => {
    (validateRequestBody as jest.Mock).mockResolvedValue({
      success: true,
      data: { CategoryName: "Test Category" },
    });

    (auth as jest.Mock).mockResolvedValue({ userId: "employee-user-789" });

    const mockSelect = jest.fn().mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue([
          { userId: "employee-user-789", role: "employee", companyId: 3 }
        ]),
      }),
    });
    (db.select as jest.Mock) = mockSelect;

    const request = new Request("http://localhost/api/Categories/AddCategories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ CategoryName: "Test Category" }),
    });

    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toBe("Invalid user role.");
  });

  it("should return validation error if CategoryName is invalid", async () => {
    (validateRequestBody as jest.Mock).mockResolvedValue({
      success: false,
      response: new Response(
        JSON.stringify({ error: "Category name is required" }),
        { status: 400 }
      ),
    });

    const request = new Request("http://localhost/api/Categories/AddCategories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ CategoryName: "" }),
    });

    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toBe("Category name is required");
  });

  it("should return 500 on database error", async () => {
    // Mock console.error to prevent test failure from error logging
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    try {
      (validateRequestBody as jest.Mock).mockResolvedValue({
        success: true,
        data: { CategoryName: "Test Category" },
      });

      (auth as jest.Mock).mockResolvedValue({ userId: "test-user-123" });

      const mockSelect = jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockRejectedValue(new Error("Database connection failed")),
        }),
      });
      (db.select as jest.Mock) = mockSelect;

      const request = new Request("http://localhost/api/Categories/AddCategories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ CategoryName: "Test Category" }),
      });

      const response = await POST(request);

      expect(response.status).toBe(500);
    } finally {
      // Restore console.error even if test fails
      consoleErrorSpy.mockRestore();
    }
  });

  it("should return 400 if auth returns null userId", async () => {
    (validateRequestBody as jest.Mock).mockResolvedValue({
      success: true,
      data: { CategoryName: "Test Category" },
    });

    (auth as jest.Mock).mockResolvedValue({ userId: null });

    const mockSelect = jest.fn().mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue([]),
      }),
    });
    (db.select as jest.Mock) = mockSelect;

    const request = new Request("http://localhost/api/Categories/AddCategories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ CategoryName: "Test Category" }),
    });

    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toBe("Invalid user.");
  });
});