import { POST } from "~/app/api/uploadDocument/route";
import { validateRequestBody } from "~/lib/validation";
import { db } from "~/server/db/index";
import { triggerDocumentProcessing } from "~/lib/ocr/trigger";

jest.mock("~/lib/validation", () => {
  const actual = jest.requireActual("~/lib/validation");
  return {
    ...actual,
    validateRequestBody: jest.fn(),
  };
});

jest.mock("~/server/db/index", () => ({
  db: {
    select: jest.fn(),
    insert: jest.fn(),
  },
}));

jest.mock("~/lib/ocr/trigger", () => ({
  triggerDocumentProcessing: jest.fn(),
  parseProvider: jest.fn((provider?: string) => provider?.toUpperCase()),
}));

jest.mock("~/env", () => ({
  env: {
    DATALAB_API_KEY: undefined,
  },
}));

describe("POST /api/uploadDocument", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("uploads and processes a document successfully", async () => {
    (validateRequestBody as jest.Mock).mockResolvedValue({
      success: true,
      data: {
        userId: "user-1",
        documentName: "Example Document",
        documentUrl: "https://example.com/doc.pdf",
        category: "contracts",
      },
    });

    const mockWhere = jest.fn().mockResolvedValue([
      { userId: "user-1", companyId: 5 },
    ]);

    const mockFrom = jest.fn().mockReturnValue({ where: mockWhere });
    (db.select as jest.Mock).mockReturnValue({ from: mockFrom });

    const mockJobId = "ocr-test-job-123";
    const mockEventIds = ["event-1", "event-2"];
    (triggerDocumentProcessing as jest.Mock).mockResolvedValue({
      jobId: mockJobId,
      eventIds: mockEventIds,
    });

    const mockDocument = {
      id: 42,
      url: "https://example.com/doc.pdf",
      title: "Example Document",
      category: "contracts",
    };

    // Mock db.insert: first call for document.insert().values().returning(), second for ocrJobs.insert().values()
    const mockReturning = jest.fn().mockResolvedValue([mockDocument]);
    const mockDocumentValues = jest.fn().mockReturnValue({
      returning: mockReturning,
    });
    const mockOcrJobsValues = jest.fn().mockResolvedValue(undefined);

    (db.insert as jest.Mock)
      .mockReturnValueOnce({
        values: mockDocumentValues,
      })
      .mockReturnValueOnce({
        values: mockOcrJobsValues,
      });

    const request = new Request("http://localhost/api/uploadDocument", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: "user-1",
        documentName: "Example Document",
        documentUrl: "https://example.com/doc.pdf",
        category: "contracts",
      }),
    });

    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(202);
    expect(json.success).toBe(true);
    expect(json.jobId).toBe(mockJobId);
    expect(json.eventIds).toEqual(mockEventIds);
    expect(json.message).toBe("Document processing started");
    expect(json.document).toMatchObject({
      id: mockDocument.id,
      url: mockDocument.url,
      title: mockDocument.title,
      category: mockDocument.category,
    });
    expect(triggerDocumentProcessing).toHaveBeenCalledTimes(1);
    expect(triggerDocumentProcessing).toHaveBeenCalledWith(
      "https://example.com/doc.pdf",
      "Example Document",
      "5",
      "user-1",
      mockDocument.id,
      "contracts",
      expect.objectContaining({
        preferredProvider: undefined,
      })
    );
    expect(db.insert).toHaveBeenCalledTimes(2);
  });

  it("handles document with preferred provider", async () => {
    (validateRequestBody as jest.Mock).mockResolvedValue({
      success: true,
      data: {
        userId: "user-1",
        documentName: "Example Document",
        documentUrl: "https://example.com/doc.pdf",
        category: "policies",
        preferredProvider: "azure",
      },
    });

    const mockWhere = jest.fn().mockResolvedValue([
      { userId: "user-1", companyId: 9 },
    ]);

    const mockFrom = jest.fn().mockReturnValue({ where: mockWhere });
    (db.select as jest.Mock).mockReturnValue({ from: mockFrom });

    const mockJobId = "ocr-test-job-456";
    const mockEventIds = ["event-3"];
    (triggerDocumentProcessing as jest.Mock).mockResolvedValue({
      jobId: mockJobId,
      eventIds: mockEventIds,
    });

    const mockDocument = {
      id: 77,
      url: "https://example.com/doc.pdf",
      title: "Example Document",
      category: "policies",
    };

    // Mock db.insert: first call for document.insert().values().returning(), second for ocrJobs.insert().values()
    const mockReturning = jest.fn().mockResolvedValue([mockDocument]);
    const mockDocumentValues = jest.fn().mockReturnValue({
      returning: mockReturning,
    });
    const mockOcrJobsValues = jest.fn().mockResolvedValue(undefined);

    (db.insert as jest.Mock)
      .mockReturnValueOnce({
        values: mockDocumentValues,
      })
      .mockReturnValueOnce({
        values: mockOcrJobsValues,
      });

    const request = new Request("http://localhost/api/uploadDocument", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: "user-1",
        documentName: "Example Document",
        documentUrl: "https://example.com/doc.pdf",
        category: "policies",
        preferredProvider: "azure",
      }),
    });

    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(202);
    expect(json.success).toBe(true);
    expect(json.jobId).toBe(mockJobId);
    expect(triggerDocumentProcessing).toHaveBeenCalledWith(
      "https://example.com/doc.pdf",
      "Example Document",
      "9",
      "user-1",
      mockDocument.id,
      "policies",
      expect.objectContaining({
        preferredProvider: "AZURE",
      })
    );
  });

  it("returns 500 when triggerDocumentProcessing fails", async () => {
    // Mock console.error to prevent test failure from error logging
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    try {
      (validateRequestBody as jest.Mock).mockResolvedValue({
        success: true,
        data: {
          userId: "user-2",
          documentName: "Broken Document",
          documentUrl: "https://example.com/broken.pdf",
          category: "finance",
        },
      });

      const mockWhere = jest.fn().mockResolvedValue([
        { userId: "user-2", companyId: 7 },
      ]);

      const mockFrom = jest.fn().mockReturnValue({ where: mockWhere });
      (db.select as jest.Mock).mockReturnValue({ from: mockFrom });

      const mockDocument = {
        id: 99,
        url: "https://example.com/broken.pdf",
        title: "Broken Document",
        category: "finance",
      };

      // Mock db.insert for document.insert().values().returning()
      const mockReturning = jest.fn().mockResolvedValue([mockDocument]);
      const mockValues = jest.fn().mockReturnValue({
        returning: mockReturning,
      });
      (db.insert as jest.Mock).mockReturnValue({
        values: mockValues,
      });

      (triggerDocumentProcessing as jest.Mock).mockRejectedValue(
        new Error("Inngest API Error: 401 Event key not found")
      );

      const request = new Request("http://localhost/api/uploadDocument", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: "user-2",
          documentName: "Broken Document",
          documentUrl: "https://example.com/broken.pdf",
          category: "finance",
        }),
      });

      const response = await POST(request);
      const json = await response.json();

      expect(response.status).toBe(500);
      expect(json.error).toBe("Failed to start document processing");
      expect(json.details).toContain("Inngest API Error");
    } finally {
      // Restore console.error even if test fails
      consoleErrorSpy.mockRestore();
    }
  });

  it("returns 400 when user is not found", async () => {
    (validateRequestBody as jest.Mock).mockResolvedValue({
      success: true,
      data: {
        userId: "invalid-user",
        documentName: "Example Document",
        documentUrl: "https://example.com/doc.pdf",
      },
    });

    const mockWhere = jest.fn().mockResolvedValue([]);
    const mockFrom = jest.fn().mockReturnValue({ where: mockWhere });
    (db.select as jest.Mock).mockReturnValue({ from: mockFrom });

    const request = new Request("http://localhost/api/uploadDocument", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: "invalid-user",
        documentName: "Example Document",
        documentUrl: "https://example.com/doc.pdf",
      }),
    });

    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toBe("Invalid user");
    expect(triggerDocumentProcessing).not.toHaveBeenCalled();
  });

  it("returns validation response when request body is invalid", async () => {
    const validationResponse = new Response(
      JSON.stringify({ error: "Invalid request" }),
      { status: 400 },
    );

    (validateRequestBody as jest.Mock).mockResolvedValue({
      success: false,
      response: validationResponse,
    });

    const request = new Request("http://localhost/api/uploadDocument", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toEqual({ error: "Invalid request" });
    expect(db.select).not.toHaveBeenCalled();
    expect(triggerDocumentProcessing).not.toHaveBeenCalled();
  });
});
