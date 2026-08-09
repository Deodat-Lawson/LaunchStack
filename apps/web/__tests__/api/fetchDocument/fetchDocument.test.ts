jest.mock("~/server/storage/vercel-blob", () => ({
  isPrivateBlobUrl: jest.fn(() => false),
  fetchBlob: jest.fn(),
  putFile: jest.fn(),
}));

// Keep the storage backend deterministic regardless of local/CI env vars —
// with S3 configured the route would rewrite http urls to the proxy path.
jest.mock("~/lib/storage", () => ({
  isS3Storage: jest.fn(() => false),
}));

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
}));

jest.mock("~/lib/validation", () => ({
  validateRequestBody: jest.fn(),
}));

// The dedicated second pool (~/server/db/core, `dbCore`) was deleted — the
// route now uses the engine's shared Drizzle client from ~/server/db, so the
// mock moves there.
jest.mock("~/server/db", () => ({
  db: {
    select: jest.fn(),
  },
}));

// The route resolves the active workspace (cookie-based multi-company
// switching) via ~/lib/active-workspace. Default to the user's own
// companyId, which mirrors the "no cookie set" production behavior.
jest.mock("~/lib/active-workspace", () => ({
  resolveActiveCompanyForUser: jest.fn(
    async (_userPk: number | bigint, defaultCompanyId: number | bigint) =>
      BigInt(defaultCompanyId),
  ),
}));

import { POST } from "~/app/api/fetchDocument/route";
import { auth } from "@clerk/nextjs/server";
import { validateRequestBody } from "~/lib/validation";
import { db } from "~/server/db";

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

    (auth as unknown as jest.Mock).mockResolvedValue({ userId: "test-user-123" });

    const mockDocuments = [
      { id: 1, title: "Document 1.pdf", url: "https://example.com/files/document-1.pdf", companyId: 1, content: "Content 1", currentVersionId: null },
      { id: 2, title: "Document 2", url: "https://example.com/files/document-2", companyId: 1, content: "Content 2", currentVersionId: null },
      { id: 3, title: "Document 3", url: "https://example.com/files/document-3", companyId: 1, content: "Content 3", currentVersionId: null },
    ];

    // First call: user lookup
    // Second call: documents lookup
    const mockSelect = jest.fn()
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([
            { id: 1, userId: "test-user-123", role: "employer", companyId: 1 }
          ]),
        }),
      })
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue(mockDocuments),
        }),
      });

    (db.select as jest.Mock) = mockSelect;

    const request = new Request("http://localhost/api/fetchDocument", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "test-user-123" }),
    });

    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    // The route enriches each document with a mimeType inferred from the
    // title/url extension when one is recognizable.
    expect(json).toEqual([
      { ...mockDocuments[0], mimeType: "application/pdf" },
      mockDocuments[1],
      mockDocuments[2],
    ]);
    expect(json).toHaveLength(3);
  });

  it("should return empty array if no documents exist for company", async () => {
    (validateRequestBody as jest.Mock).mockResolvedValue({
      success: true,
      data: { userId: "test-user-456" },
    });

    (auth as unknown as jest.Mock).mockResolvedValue({ userId: "test-user-456" });

    const mockSelect = jest.fn()
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([
            { id: 1, userId: "test-user-456", role: "employer", companyId: 2 }
          ]),
        }),
      })
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([]), // No documents
        }),
      });

    (db.select as jest.Mock) = mockSelect;

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

    (auth as unknown as jest.Mock).mockResolvedValue({ userId: "invalid-user-999" });

    // Mock user lookup - return empty array (user not found)
    const mockSelect = jest.fn().mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue([]),
      }),
    });
    (db.select as jest.Mock) = mockSelect;

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

      (auth as unknown as jest.Mock).mockResolvedValue({ userId: "test-user-123" });

      // Mock database error on user lookup
      const mockSelect = jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockRejectedValue(new Error("Database connection failed")),
        }),
      });
      (db.select as jest.Mock) = mockSelect;

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

      (auth as unknown as jest.Mock).mockResolvedValue({ userId: "test-user-123" });

      // First call succeeds (user lookup), second call fails (documents fetch)
      const mockSelect = jest.fn()
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([
              { id: 1, userId: "test-user-123", role: "employer", companyId: 1 }
            ]),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockRejectedValue(new Error("Failed to fetch documents")),
          }),
        });

      (db.select as jest.Mock) = mockSelect;

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

    (auth as unknown as jest.Mock).mockResolvedValue({ userId: null });

    const mockSelect = jest.fn().mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue([]),
      }),
    });
    (db.select as jest.Mock) = mockSelect;

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

    (auth as unknown as jest.Mock).mockResolvedValue({ userId: "test-user-123" });

    // Documents for company 1 only
    const mockDocuments = [
      { id: 1, title: "Company 1 Doc", url: "https://example.com/files/doc-1", companyId: 1, currentVersionId: null },
      { id: 2, title: "Another Company 1 Doc", url: "https://example.com/files/doc-2", companyId: 1, currentVersionId: null },
    ];

    const mockSelect = jest.fn()
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([
            { id: 1, userId: "test-user-123", role: "employer", companyId: 1 }
          ]),
        }),
      })
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue(mockDocuments),
        }),
      });

    (db.select as jest.Mock) = mockSelect;

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

    (auth as unknown as jest.Mock).mockResolvedValue({ userId: "test-user-789" });

    const mockDocuments = [
      { id: 10, title: "Company 5 Doc", url: "https://example.com/files/doc-10", companyId: 5, currentVersionId: null },
      { id: 11, title: "Another Company 5 Doc", url: "https://example.com/files/doc-11", companyId: 5, currentVersionId: null },
    ];

    const mockSelect = jest.fn()
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([
            { id: 1, userId: "test-user-789", role: "employee", companyId: 5 }
          ]),
        }),
      })
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue(mockDocuments),
        }),
      });

    (db.select as jest.Mock) = mockSelect;

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

    (auth as unknown as jest.Mock).mockResolvedValue({ userId: "employee-user-111" });

    const mockDocuments = [
      { id: 20, title: "Employee Doc", url: "https://example.com/files/doc-20", companyId: 3, currentVersionId: null },
    ];

    const mockSelect = jest.fn()
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([
            { id: 1, userId: "employee-user-111", role: "employee", companyId: 3 }
          ]),
        }),
      })
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue(mockDocuments),
        }),
      });

    (db.select as jest.Mock) = mockSelect;

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
