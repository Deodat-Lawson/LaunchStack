import { DELETE } from "~/app/api/Categories/DeleteCategories/route";
import { auth } from "@clerk/nextjs/server";
import { validateRequestBody } from "~/lib/validation";
import { db } from "~/server/db/index";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
}));

jest.mock("~/lib/validation", () => ({
  validateRequestBody: jest.fn(),
}));

jest.mock("~/server/db/index", () => ({
  db: {
    select: jest.fn(),
    delete: jest.fn(),
  },
}));

describe("DELETE /api/Categories/DeleteCategory", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should allow an authenticated employer to delete a category", async () => {
    (validateRequestBody as jest.Mock).mockResolvedValue({
      success: true,
      data: { id: "123" },
    });

    (auth as unknown as jest.Mock).mockResolvedValue({ userId: "employer-user-123" });

    // Mock user lookup - return employer
    const mockSelect = jest.fn().mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue([
          { userId: "employer-user-123", role: "employer", companyId: 1 }
        ]),
      }),
    });
    (db.select as jest.Mock) = mockSelect;

    // Mock delete operation
    const mockDelete = jest.fn().mockReturnValue({
      where: jest.fn().mockResolvedValue(undefined),
    });
    (db.delete as jest.Mock) = mockDelete;

    const request = new Request("http://localhost/api/Categories/DeleteCategory", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "123" }),
    });

    const response = await DELETE(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(mockDelete).toHaveBeenCalled();
  });

  it("should allow an authenticated owner to delete a category", async () => {
    (validateRequestBody as jest.Mock).mockResolvedValue({
      success: true,
      data: { id: "456" },
    });

    (auth as unknown as jest.Mock).mockResolvedValue({ userId: "owner-user-456" });

    // Mock user lookup - return owner
    const mockSelect = jest.fn().mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue([
          { userId: "owner-user-456", role: "owner", companyId: 2 }
        ]),
      }),
    });
    (db.select as jest.Mock) = mockSelect;

    const mockDelete = jest.fn().mockReturnValue({
      where: jest.fn().mockResolvedValue(undefined),
    });
    (db.delete as jest.Mock) = mockDelete;

    const request = new Request("http://localhost/api/Categories/DeleteCategory", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "456" }),
    });

    const response = await DELETE(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
  });

  it("should return 400 if user is not found", async () => {
    (validateRequestBody as jest.Mock).mockResolvedValue({
      success: true,
      data: { id: "123" },
    });

    (auth as unknown as jest.Mock).mockResolvedValue({ userId: "invalid-user-999" });

    // Mock user lookup - return empty array (user not found)
    const mockSelect = jest.fn().mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue([]),
      }),
    });
    (db.select as jest.Mock) = mockSelect;

    const request = new Request("http://localhost/api/Categories/DeleteCategory", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "123" }),
    });

    const response = await DELETE(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toBe("Invalid user.");
  });

  it("should return 400 if user has invalid role (employee)", async () => {
    (validateRequestBody as jest.Mock).mockResolvedValue({
      success: true,
      data: { id: "123" },
    });

    (auth as unknown as jest.Mock).mockResolvedValue({ userId: "employee-user-789" });

    // Mock user lookup - return employee (invalid role)
    const mockSelect = jest.fn().mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue([
          { userId: "employee-user-789", role: "employee", companyId: 3 }
        ]),
      }),
    });
    (db.select as jest.Mock) = mockSelect;

    const request = new Request("http://localhost/api/Categories/DeleteCategory", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "123" }),
    });

    const response = await DELETE(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toBe("Invalid user role.");
  });

  it("should return validation error if id is missing", async () => {
    // Mock failed validation
    (validateRequestBody as jest.Mock).mockResolvedValue({
      success: false,
      response: new Response(
        JSON.stringify({ error: "Category ID is required" }),
        { status: 400 }
      ),
    });

    const request = new Request("http://localhost/api/Categories/DeleteCategory", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "" }), // Empty id
    });

    const response = await DELETE(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toBe("Category ID is required");
  });

  it("should return validation error if id is not provided", async () => {
    (validateRequestBody as jest.Mock).mockResolvedValue({
      success: false,
      response: new Response(
        JSON.stringify({ error: "Category ID is required" }),
        { status: 400 }
      ),
    });

    const request = new Request("http://localhost/api/Categories/DeleteCategory", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}), // No id field
    });

    const response = await DELETE(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toBe("Category ID is required");
  });

  it("should return 500 on database error", async () => {
    // Mock console.error to prevent test failure from error logging
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    try {
      (validateRequestBody as jest.Mock).mockResolvedValue({
        success: true,
        data: { id: "123" },
      });

      (auth as unknown as jest.Mock).mockResolvedValue({ userId: "test-user-123" });

      // Mock database error on select
      const mockSelect = jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockRejectedValue(new Error("Database error")),
        }),
      });
      (db.select as jest.Mock) = mockSelect;

      const request = new Request("http://localhost/api/Categories/DeleteCategory", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "123" }),
      });

      const response = await DELETE(request);

      expect(response.status).toBe(500);
    } finally {
      // Restore console.error even if test fails
      consoleErrorSpy.mockRestore();
    }
  });

  it("should return 500 on delete operation error", async () => {
    // Mock console.error to prevent test failure from error logging
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    try {
      (validateRequestBody as jest.Mock).mockResolvedValue({
        success: true,
        data: { id: "123" },
      });

      (auth as unknown as jest.Mock).mockResolvedValue({ userId: "employer-user-123" });

      const mockSelect = jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([
            { userId: "employer-user-123", role: "employer", companyId: 1 }
          ]),
        }),
      });
      (db.select as jest.Mock) = mockSelect;

      // Mock delete operation error
      const mockDelete = jest.fn().mockReturnValue({
        where: jest.fn().mockRejectedValue(new Error("Delete failed")),
      });
      (db.delete as jest.Mock) = mockDelete;

      const request = new Request("http://localhost/api/Categories/DeleteCategory", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "123" }),
      });

      const response = await DELETE(request);

      expect(response.status).toBe(500);
    } finally {
      // Restore console.error even if test fails
      consoleErrorSpy.mockRestore();
    }
  });

  it("should return 400 if auth returns null userId", async () => {
    (validateRequestBody as jest.Mock).mockResolvedValue({
      success: true,
      data: { id: "123" },
    });

    (auth as unknown as jest.Mock).mockResolvedValue({ userId: null });

    const mockSelect = jest.fn().mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue([]),
      }),
    });
    (db.select as jest.Mock) = mockSelect;

    const request = new Request("http://localhost/api/Categories/DeleteCategory", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "123" }),
    });

    const response = await DELETE(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toBe("Invalid user.");
  });
});