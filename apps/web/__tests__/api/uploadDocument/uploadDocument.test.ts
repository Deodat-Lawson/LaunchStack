import { POST } from "~/app/api/uploadDocument/route";
import { validateRequestBody } from "~/lib/validation";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import type { WorkspaceContext } from "~/lib/require-workspace-context";
import {
  processDocumentUpload,
  type DocumentUploadResult,
} from "~/server/services/document-upload";
import { UploadAuthorizationError } from "~/server/services/internal-file-ref";

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

jest.mock("~/lib/rate-limit-middleware", () => ({
  withRateLimit: (
    _request: Request,
    _config: unknown,
    handler: () => Promise<Response>,
  ) => handler(),
}));

jest.mock("~/lib/rate-limiter", () => ({
  RateLimitPresets: { strict: {} },
}));

jest.mock("~/server/db", () => ({
  db: {
    select: jest.fn(),
  },
}));

jest.mock("~/server/engine", () => ({
  getEngine: jest.fn().mockReturnValue({}),
}));

jest.mock("~/server/services/document-upload", () => ({
  processDocumentUpload: jest.fn(),
}));

type UploadResult = DocumentUploadResult;

const processDocumentUploadMock = processDocumentUpload as jest.MockedFunction<
  typeof processDocumentUpload
>;

const VERIFIED_DATA: WorkspaceContext = {
  clerkUserId: "user-1",
  userPk: BigInt(7),
  companyId: BigInt(5),
  role: "owner",
  status: "verified",
};

function mockAuthenticatedContext(overrides?: Partial<WorkspaceContext>) {
  const data = { ...VERIFIED_DATA, ...overrides };
  (requireWorkspaceContext as jest.Mock).mockResolvedValue({ success: true, data });
  return data;
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

function mockValidRequest(data: Record<string, unknown>) {
  (validateRequestBody as jest.Mock).mockResolvedValue({
    success: true,
    data,
  });
}

function requestFor(body: Record<string, unknown>) {
  return new Request("http://localhost/api/uploadDocument", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function mockUploadResult(overrides: Partial<UploadResult> = {}): UploadResult {
  return {
    jobId: "ocr-test-job",
    eventIds: ["event-1"],
    storageType: "s3",
    document: {
      id: 42,
      url: "https://example.com/doc.pdf",
      title: "Example Document",
      category: "contracts",
    },
    resolvedDocumentUrl: "https://example.com/doc.pdf",
    ...overrides,
  };
}

describe("POST /api/uploadDocument", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("uploads and processes a document successfully", async () => {
    const ctx = mockAuthenticatedContext();
    const body = {
      documentName: "Example Document",
      documentUrl: "https://example.com/doc.pdf",
      category: "contracts",
    };
    mockValidRequest(body);

    const uploadResult = mockUploadResult({
      jobId: "ocr-test-job-123",
      eventIds: ["event-1", "event-2"],
      document: {
        id: 42,
        url: body.documentUrl,
        title: body.documentName,
        category: body.category,
      },
    });
    processDocumentUploadMock.mockResolvedValue(uploadResult);

    const response = await POST(requestFor(body));
    const json = await response.json();

    expect(response.status).toBe(202);
    expect(json).toMatchObject({
      success: true,
      jobId: uploadResult.jobId,
      eventIds: uploadResult.eventIds,
      message: "Document processing started",
      storageType: "s3",
      document: uploadResult.document,
    });
    expect(processDocumentUploadMock).toHaveBeenCalledWith(
      expect.objectContaining({
        user: { userId: ctx.clerkUserId, companyId: ctx.companyId },
        documentName: body.documentName,
        rawDocumentUrl: body.documentUrl,
        category: body.category,
        creationKey: `upload:${body.documentUrl}`,
        requestUrl: "http://localhost/api/uploadDocument",
      }),
    );
  });

  it("handles document with preferred provider", async () => {
    const ctx = mockAuthenticatedContext({ companyId: BigInt(9) });
    const body = {
      documentName: "Example Document",
      documentUrl: "https://example.com/doc.pdf",
      category: "policies",
      preferredProvider: "azure",
    };
    mockValidRequest(body);
    processDocumentUploadMock.mockResolvedValue(
      mockUploadResult({
        jobId: "ocr-test-job-456",
        eventIds: ["event-3"],
        document: {
          id: 77,
          url: body.documentUrl,
          title: body.documentName,
          category: body.category,
        },
      }),
    );

    const response = await POST(requestFor(body));
    const json = await response.json();

    expect(response.status).toBe(202);
    expect(json).toMatchObject({
      success: true,
      jobId: "ocr-test-job-456",
      eventIds: ["event-3"],
      message: "Document processing started",
    });
    expect(processDocumentUploadMock).toHaveBeenCalledWith(
      expect.objectContaining({
        user: { userId: ctx.clerkUserId, companyId: ctx.companyId },
        preferredProvider: "azure",
        creationKey: `upload:${body.documentUrl}`,
      }),
    );
  });

  it("returns 500 when document processing fails", async () => {
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const ctx = mockAuthenticatedContext({ companyId: BigInt(7) });
    const body = {
      documentName: "Broken Document",
      documentUrl: "https://example.com/broken.pdf",
      category: "finance",
    };
    const processingError = new Error("Inngest API Error: 401 Event key not found");

    try {
      mockValidRequest(body);
      processDocumentUploadMock.mockRejectedValue(processingError);

      const response = await POST(requestFor(body));
      const json = await response.json();

      expect(response.status).toBe(500);
      expect(json.error).toBe("Failed to start document processing");
      expect(processDocumentUploadMock).toHaveBeenCalledWith(
        expect.objectContaining({
          user: { userId: ctx.clerkUserId, companyId: ctx.companyId },
          creationKey: `upload:${body.documentUrl}`,
        }),
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Error triggering document processing"),
        processingError,
      );
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it("returns 401 when workspace context fails (unauthenticated)", async () => {
    mockUnauthenticated();

    const response = await POST(
      requestFor({
        documentName: "Example Document",
        documentUrl: "https://example.com/doc.pdf",
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json.error).toBe("Unauthorized");
    expect(validateRequestBody).not.toHaveBeenCalled();
    expect(processDocumentUploadMock).not.toHaveBeenCalled();
  });

  // Declaring s3 storage used to keep a foreign /api/files path intact all the
  // way to the OCR token signer. The service throws UploadAuthorizationError;
  // the route must surface that status instead of a generic 500.
  it("maps UploadAuthorizationError for a foreign internal file", async () => {
    mockAuthenticatedContext({ companyId: BigInt(5) });
    const body = {
      documentName: "Someone else's file",
      documentUrl: "/api/files/123",
      storageType: "s3",
    };
    mockValidRequest(body);
    processDocumentUploadMock.mockRejectedValue(
      new UploadAuthorizationError("File not found in this workspace", 404),
    );

    const response = await POST(requestFor(body));
    const json = await response.json();

    expect(response.status).toBe(404);
    expect(json.error).toBe("File not found in this workspace");
    expect(processDocumentUploadMock).toHaveBeenCalledWith(
      expect.objectContaining({
        user: { userId: "user-1", companyId: BigInt(5) },
        rawDocumentUrl: body.documentUrl,
        explicitStorageType: "s3",
        creationKey: `upload:${body.documentUrl}`,
      }),
    );
  });

  it("accepts an internal file id scoped to the active workspace", async () => {
    const ctx = mockAuthenticatedContext({ companyId: BigInt(5) });
    const body = {
      documentName: "Our file",
      documentUrl: "/api/files/123",
    };
    mockValidRequest(body);
    processDocumentUploadMock.mockResolvedValue(
      mockUploadResult({
        jobId: "job-1",
        eventIds: [],
        document: {
          id: 5,
          url: body.documentUrl,
          title: body.documentName,
          category: "Uncategorized",
        },
        resolvedDocumentUrl: "http://localhost/api/files/123",
      }),
    );

    const response = await POST(requestFor(body));
    const json = await response.json();

    expect(response.status).toBe(202);
    expect(json.success).toBe(true);
    expect(processDocumentUploadMock).toHaveBeenCalledWith(
      expect.objectContaining({
        user: { userId: ctx.clerkUserId, companyId: ctx.companyId },
        rawDocumentUrl: body.documentUrl,
        creationKey: `upload:${body.documentUrl}`,
      }),
    );
  });

  it("maps UploadAuthorizationError when OSS signing is unavailable", async () => {
    mockAuthenticatedContext({ companyId: BigInt(5) });
    const body = {
      documentName: "Needs OSS signing",
      documentUrl: "/api/files/123",
      preferredProvider: "DOCLING",
    };
    mockValidRequest(body);
    processDocumentUploadMock.mockRejectedValue(
      new UploadAuthorizationError(
        "FILE_ACCESS_TOKEN_SECRET is not configured; the OCR worker cannot read database-backed documents.",
        503,
      ),
    );

    const response = await POST(requestFor(body));
    const json = await response.json();

    expect(response.status).toBe(503);
    expect(json.error).toMatch(/FILE_ACCESS_TOKEN_SECRET/);
    expect(processDocumentUploadMock).toHaveBeenCalledWith(
      expect.objectContaining({
        user: { userId: "user-1", companyId: BigInt(5) },
        preferredProvider: "DOCLING",
        creationKey: `upload:${body.documentUrl}`,
      }),
    );
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

    const response = await POST(requestFor({}));
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toEqual({ error: "Invalid request" });
    expect(processDocumentUploadMock).not.toHaveBeenCalled();
  });
});
