import { POST } from "~/app/api/fetchDocument/route";
import { auth } from "@clerk/nextjs/server";
import { validateRequestBody } from "~/lib/validation";
import { dbCore } from "~/server/db/core";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
}));

jest.mock("~/lib/validation", () => ({
  validateRequestBody: jest.fn(),
}));

// Route uses dbCore from core, not db from index
jest.mock("~/server/db/core", () => ({
  dbCore: {
    select: jest.fn(),
  },
}));

describe("POST /api/fetchDocument", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should successfully fetch documents for authenticated user", async () => {
    // Mock successful validation
    (validateRequestBody as jest.Mock).mockResolvedValue({
      success: true,
      data: { userId: "test-user-123" },
    });

    (auth as jest.Mock).mockResolvedValue({ userId: "test-user-123" });

    const mockDocuments = [
      { id: 1, name: "Document 1", companyId: 1, content: "Content 1" },
      { id: 2, name: "Document 2", companyId: 1, content: "Content 2" },
      { id: 3, name: "Document 3", companyId: 1, content: "Content 3" },
    ];

    // First call: user lookup
    // Second call: documents lookup
    const mockSelect = jest.fn()
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([
            { userId: "test-user-123", role: "employer", companyId: 1 }
          ]),
        }),
      })
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue(mockDocuments),
        }),
      });

    (dbCore.select as jest.Mock) = mockSelect;

    const request = new Request("http://localhost/api/fetchDocument", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "test-user-123" }),
    });

    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual(mockDocuments);
    expect(json).toHaveLength(3);
  });

  it("should return empty array if no documents exist for company", async () => {
    (validateRequestBody as jest.Mock).mockResolvedValue({
      success: true,
      data: { userId: "test-user-456" },
    });

    (auth as jest.Mock).mockResolvedValue({ userId: "test-user-456" });

    const mockSelect = jest.fn()
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([
            { userId: "test-user-456", role: "employer", companyId: 2 }
          ]),
        }),
      })
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([]), // No documents
        }),
      });

    (dbCore.select as jest.Mock) = mockSelect;

    const request = new Request("http://localhost/api/fetchDocument", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "test-user-456" }),
    });

    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual([]);
    expect(json).toHaveLength(0);
  });

  it("should return 400 if user is not found", async () => {
    (validateRequestBody as jest.Mock).mockResolvedValue({
      success: true,
      data: { userId: "invalid-user-999" },
    });

    (auth as jest.Mock).mockResolvedValue({ userId: "invalid-user-999" });

    // Mock user lookup - return empty array (user not found)
    const mockSelect = jest.fn().mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue([]),
      }),
    });
    (dbCore.select as jest.Mock) = mockSelect;

    const request = new Request("http://localhost/api/fetchDocument", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "invalid-user-999" }),
    });

    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toBe("Invalid user.");
  });

  it("should return validation error if request body is invalid", async () => {
    // Mock failed validation
    (validateRequestBody as jest.Mock).mockResolvedValue({
      success: false,
      response: new Response(
        JSON.stringify({ error: "userId is required" }),
        { status: 400 }
      ),
    });

    const request = new Request("http://localhost/api/fetchDocument", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}), // Missing userId
    });

    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toBe("userId is required");
  });

  it("should return validation error if userId is empty", async () => {
    (validateRequestBody as jest.Mock).mockResolvedValue({
      success: false,
      response: new Response(
        JSON.stringify({ error: "userId cannot be empty" }),
        { status: 400 }
      ),
    });

    const request = new Request("http://localhost/api/fetchDocument", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "" }), // Empty userId
    });

    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toBe("userId cannot be empty");
  });

  it("should return 500 on database error during user lookup", async () => {
    // Mock console.error to prevent test failure from error logging
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    try {
      (validateRequestBody as jest.Mock).mockResolvedValue({
        success: true,
        data: { userId: "test-user-123" },
      });

      (auth as jest.Mock).mockResolvedValue({ userId: "test-user-123" });

      // Mock database error on user lookup
      const mockSelect = jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockRejectedValue(new Error("Database connection failed")),
        }),
      });
      (dbCore.select as jest.Mock) = mockSelect;

      const request = new Request("http://localhost/api/fetchDocument", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "test-user-123" }),
      });

      const response = await POST(request);
      const json = await response.json();

      expect(response.status).toBe(500);
      expect(json.error).toBe("Unable to fetch documents");
    } finally {
      // Restore console.error even if test fails
      consoleErrorSpy.mockRestore();
    }
  });

  it("should return 500 on database error during documents fetch", async () => {
    // Mock console.error to prevent test failure from error logging
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    try {
      (validateRequestBody as jest.Mock).mockResolvedValue({
        success: true,
        data: { userId: "test-user-123" },
      });

      (auth as jest.Mock).mockResolvedValue({ userId: "test-user-123" });

      // First call succeeds (user lookup), second call fails (documents fetch)
      const mockSelect = jest.fn()
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([
              { userId: "test-user-123", role: "employer", companyId: 1 }
            ]),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockRejectedValue(new Error("Failed to fetch documents")),
          }),
        });

      (dbCore.select as jest.Mock) = mockSelect;

      const request = new Request("http://localhost/api/fetchDocument", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "test-user-123" }),
      });

      const response = await POST(request);
      const json = await response.json();

      expect(response.status).toBe(500);
      expect(json.error).toBe("Unable to fetch documents");
    } finally {
      // Restore console.error even if test fails
      consoleErrorSpy.mockRestore();
    }
  });

  it("should return 400 if auth returns null userId", async () => {
    (validateRequestBody as jest.Mock).mockResolvedValue({
      success: true,
      data: { userId: "test-user-123" },
    });

    (auth as jest.Mock).mockResolvedValue({ userId: null });

    const mockSelect = jest.fn().mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue([]),
      }),
    });
    (dbCore.select as jest.Mock) = mockSelect;

    const request = new Request("http://localhost/api/fetchDocument", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "test-user-123" }),
    });

    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toBe("Invalid user.");
  });

  it("should only return documents for the user's company", async () => {
    (validateRequestBody as jest.Mock).mockResolvedValue({
      success: true,
      data: { userId: "test-user-123" },
    });

    (auth as jest.Mock).mockResolvedValue({ userId: "test-user-123" });

    // Documents for company 1 only
    const mockDocuments = [
      { id: 1, name: "Company 1 Doc", companyId: 1 },
      { id: 2, name: "Another Company 1 Doc", companyId: 1 },
    ];

    const mockSelect = jest.fn()
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([
            { userId: "test-user-123", role: "employer", companyId: 1 }
          ]),
        }),
      })
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue(mockDocuments),
        }),
      });

    (dbCore.select as jest.Mock) = mockSelect;

    const request = new Request("http://localhost/api/fetchDocument", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "test-user-123" }),
    });

    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    // Verify all documents belong to companyId 1
    json.forEach((doc: any) => {
      expect(doc.companyId).toBe(1);
    });
  });

  it("should handle user with different companyId", async () => {
    (validateRequestBody as jest.Mock).mockResolvedValue({
      success: true,
      data: { userId: "test-user-789" },
    });

    (auth as jest.Mock).mockResolvedValue({ userId: "test-user-789" });

    const mockDocuments = [
      { id: 10, name: "Company 5 Doc", companyId: 5 },
      { id: 11, name: "Another Company 5 Doc", companyId: 5 },
    ];

    const mockSelect = jest.fn()
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([
            { userId: "test-user-789", role: "employee", companyId: 5 }
          ]),
        }),
      })
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue(mockDocuments),
        }),
      });

    (dbCore.select as jest.Mock) = mockSelect;

    const request = new Request("http://localhost/api/fetchDocument", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "test-user-789" }),
    });

    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toHaveLength(2);
    json.forEach((doc: any) => {
      expect(doc.companyId).toBe(5);
    });
  });

  it("should work for any user role (no role restriction)", async () => {
    (validateRequestBody as jest.Mock).mockResolvedValue({
      success: true,
      data: { userId: "employee-user-111" },
    });

    (auth as jest.Mock).mockResolvedValue({ userId: "employee-user-111" });

    const mockDocuments = [
      { id: 20, name: "Employee Doc", companyId: 3 },
    ];

    const mockSelect = jest.fn()
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([
            { userId: "employee-user-111", role: "employee", companyId: 3 }
          ]),
        }),
      })
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue(mockDocuments),
        }),
      });

    (dbCore.select as jest.Mock) = mockSelect;

    const request = new Request("http://localhost/api/fetchDocument", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "employee-user-111" }),
    });

    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual(mockDocuments);
  });
});