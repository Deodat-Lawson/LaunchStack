import { POST } from "~/app/api/uploadDocument/route";
import { validateRequestBody } from "~/lib/validation";
import { db } from "~/server/db";
import { triggerDocumentProcessing } from "@launchstack/core/ocr/trigger";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import type { WorkspaceContextResult } from "~/lib/require-workspace-context";

jest.mock("~/lib/require-workspace-context", () => ({
  requireWorkspaceContext: jest.fn(),
}));

jest.mock("~/lib/validation", () => {
  const actual = jest.requireActual("~/lib/validation");
  return {
    ...actual,
    validateRequestBody: jest.fn(),
  };
});

jest.mock("~/server/db", () => {
  const transaction = jest.fn().mockImplementation(async (cb: (tx: unknown) => unknown) => {
    const tx = {
      insert: jest.fn().mockImplementation(() => ({
        values: jest.fn().mockImplementation(() => ({
          returning: jest.fn().mockResolvedValue([{ id: 1 }]),
        })),
      })),
      update: jest.fn().mockImplementation(() => ({
        set: jest.fn().mockImplementation(() => ({
          where: jest.fn().mockResolvedValue(undefined),
        })),
      })),
    };
    return cb(tx);
  });
  return {
    db: {
      select: jest.fn(),
      insert: jest.fn(),
      transaction,
    },
  };
});

jest.mock("@launchstack/core/ocr/trigger", () => ({
  triggerDocumentProcessing: jest.fn(),
  parseProvider: jest.fn((provider?: string) => provider?.toUpperCase()),
}));

jest.mock("~/env", () => ({
  env: {
    DATALAB_API_KEY: undefined,
  },
}));

jest.mock("~/lib/credits", () => ({
  hasTokens: jest.fn().mockResolvedValue(true),
}));

jest.mock("~/server/engine", () => ({
  getEngine: jest.fn().mockReturnValue({}),
}));

import { configureDatabase, type DbClient } from "@launchstack/core/db";
configureDatabase({
  select: jest.fn().mockReturnValue({
    from: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue({
        limit: jest.fn().mockResolvedValue([]),
      }),
    }),
  }),
} as unknown as DbClient);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VERIFIED_CTX: WorkspaceContextResult = {
  success: true,
  data: {
    clerkUserId: "user-1",
    userPk: BigInt(7),
    companyId: BigInt(5),
    role: "employer",
    status: "verified",
  },
};

function mockAuthenticatedContext(overrides?: Partial<typeof VERIFIED_CTX.data>) {
  const data = { ...(VERIFIED_CTX as { success: true; data: typeof VERIFIED_CTX extends { success: true; data: infer D } ? D : never }).data, ...overrides };
  (requireWorkspaceContext as jest.Mock).mockResolvedValue({ success: true, data });
}

function mockUnauthenticated() {
  (requireWorkspaceContext as jest.Mock).mockResolvedValue({
    success: false,
    response: new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    }),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/uploadDocument", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("uploads and processes a document successfully", async () => {
    mockAuthenticatedContext();

    (validateRequestBody as jest.Mock).mockResolvedValue({
      success: true,
      data: {
        documentName: "Example Document",
        documentUrl: "https://example.com/doc.pdf",
        category: "contracts",
      },
    });

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
    mockAuthenticatedContext({ companyId: BigInt(9) });

    (validateRequestBody as jest.Mock).mockResolvedValue({
      success: true,
      data: {
        documentName: "Example Document",
        documentUrl: "https://example.com/doc.pdf",
        category: "policies",
        preferredProvider: "azure",
      },
    });

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
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    try {
      mockAuthenticatedContext({ companyId: BigInt(7) });

      (validateRequestBody as jest.Mock).mockResolvedValue({
        success: true,
        data: {
          documentName: "Broken Document",
          documentUrl: "https://example.com/broken.pdf",
          category: "finance",
        },
      });

      const mockDocument = {
        id: 99,
        url: "https://example.com/broken.pdf",
        title: "Broken Document",
        category: "finance",
      };

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
          documentName: "Broken Document",
          documentUrl: "https://example.com/broken.pdf",
          category: "finance",
        }),
      });

      const response = await POST(request);
      const json = await response.json();

      expect(response.status).toBe(500);
      expect(json.error).toBe("Failed to start document processing");
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Error triggering document processing"),
        expect.objectContaining({
          message: expect.stringContaining("Inngest API Error"),
        }),
      );
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it("returns 401 when workspace context fails (unauthenticated)", async () => {
    mockUnauthenticated();

    const request = new Request("http://localhost/api/uploadDocument", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        documentName: "Example Document",
        documentUrl: "https://example.com/doc.pdf",
      }),
    });

    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json.error).toBe("Unauthorized");
    expect(validateRequestBody).not.toHaveBeenCalled();
    expect(triggerDocumentProcessing).not.toHaveBeenCalled();
  });

  it("returns validation response when request body is invalid", async () => {
    mockAuthenticatedContext();

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
    expect(triggerDocumentProcessing).not.toHaveBeenCalled();
  });
});
