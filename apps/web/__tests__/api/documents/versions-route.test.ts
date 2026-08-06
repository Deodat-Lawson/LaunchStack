import { POST } from "~/app/api/documents/[id]/versions/route";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { validateRequestBody } from "~/lib/validation";
import { db } from "~/server/db";
import { getOcrConfig } from "@launchstack/core/ocr/config";
import { parseProvider, triggerDocumentProcessing } from "@launchstack/core/ocr/trigger";
import {
  authorizeInternalFileRef,
  UploadAuthorizationError,
} from "~/server/services/internal-file-ref";

jest.mock("~/lib/require-workspace-context", () => ({
  requireWorkspaceContext: jest.fn(),
  isManagementRole: (role: string) => role === "owner" || role === "admin",
}));

jest.mock("~/lib/validation", () => ({
  validateRequestBody: jest.fn(),
}));

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

jest.mock("~/server/engine", () => ({
  getEngine: jest.fn().mockReturnValue({}),
}));

jest.mock("~/server/services/internal-file-ref", () => {
  class MockUploadAuthorizationError extends Error {
    status: number;

    constructor(message: string, status = 503) {
      super(message);
      this.name = "UploadAuthorizationError";
      this.status = status;
    }
  }

  return {
    authorizeInternalFileRef: jest.fn(),
    UploadAuthorizationError: MockUploadAuthorizationError,
  };
});

jest.mock("~/server/db", () => ({
  db: {
    select: jest.fn(),
    transaction: jest.fn(),
    insert: jest.fn(),
  },
}));

jest.mock("@launchstack/core/db/schema", () => ({
  document: {
    id: "document.id",
  },
  documentVersions: {
    documentId: "documentVersions.documentId",
    versionNumber: "documentVersions.versionNumber",
    id: "documentVersions.id",
  },
  ocrJobs: {},
}));

jest.mock("@launchstack/core/ocr/config", () => ({
  getOcrConfig: jest.fn(),
}));

jest.mock("@launchstack/core/ocr/trigger", () => ({
  parseProvider: jest.fn((provider?: string) =>
    provider ? provider.toUpperCase() : undefined,
  ),
  triggerDocumentProcessing: jest.fn(),
}));

jest.mock("drizzle-orm", () => ({
  desc: (column: unknown) => ({ op: "desc", column }),
  eq: (column: unknown, value: unknown) => ({ op: "eq", column, value }),
  sql: () => ({ op: "sql" }),
}));

const workspaceContext = {
  clerkUserId: "user-1",
  userPk: BigInt(7),
  companyId: BigInt(10),
  role: "owner" as const,
  status: "verified" as const,
};

const documentRow = {
  id: 55,
  companyId: BigInt(10),
  title: "Contract",
  category: "contracts",
  fileType: "application/pdf",
  url: "https://app.example/api/files/99",
};

const mockSelect = db.select as jest.Mock;
const mockTransaction = db.transaction as jest.Mock;
const mockInsert = db.insert as jest.Mock;

function setupDatabase() {
  const selectWhere = jest.fn().mockResolvedValue([documentRow]);
  const selectFrom = jest.fn().mockReturnValue({ where: selectWhere });
  mockSelect.mockReturnValue({ from: selectFrom });

  const txSelectWhere = jest.fn().mockResolvedValue([{ maxVersion: 1 }]);
  const txSelectFrom = jest.fn().mockReturnValue({ where: txSelectWhere });
  const txSelect = jest.fn().mockReturnValue({ from: txSelectFrom });
  const txInsertValues = jest.fn().mockReturnValue({
    returning: jest.fn().mockResolvedValue([{ id: 77, versionNumber: 2 }]),
  });
  const txInsert = jest.fn().mockReturnValue({ values: txInsertValues });
  const txUpdateWhere = jest.fn().mockResolvedValue(undefined);
  const txUpdateSet = jest.fn().mockReturnValue({ where: txUpdateWhere });
  const txUpdate = jest.fn().mockReturnValue({ set: txUpdateSet });

  mockTransaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
    callback({ select: txSelect, insert: txInsert, update: txUpdate }),
  );

  const jobValues = jest.fn().mockResolvedValue(undefined);
  mockInsert.mockReturnValue({ values: jobValues });

  return { txInsertValues, txUpdateSet, jobValues };
}

function setupAuthenticatedRequest() {
  (requireWorkspaceContext as jest.Mock).mockResolvedValue({
    success: true,
    data: workspaceContext,
  });
  (getOcrConfig as jest.Mock).mockReturnValue({
    defaultProvider: "DOCLING",
    appPublicUrl: "https://app.example",
  });
  (validateRequestBody as jest.Mock).mockResolvedValue({
    success: true,
    data: {
      documentUrl: "https://app.example/api/files/123/?source=upload",
      mimeType: "application/pdf",
      originalFilename: "contract.pdf",
      preferredProvider: "docling",
    },
  });
  (authorizeInternalFileRef as jest.Mock).mockResolvedValue(123);
  (triggerDocumentProcessing as jest.Mock).mockResolvedValue({
    jobId: "job-1",
    eventIds: ["event-1"],
  });
}

function request() {
  return new Request("https://app.example/api/documents/55/versions", {
    method: "POST",
    body: JSON.stringify({}),
    headers: { "Content-Type": "application/json" },
  });
}

function routeContext() {
  return { params: Promise.resolve({ id: "55" }) };
}

describe("POST /api/documents/[id]/versions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupDatabase();
    setupAuthenticatedRequest();
  });

  it("persists and dispatches the effective provider with a canonical internal URL", async () => {
    const { txInsertValues, txUpdateSet, jobValues } = setupDatabase();

    const response = await POST(request(), routeContext());

    expect(response.status).toBe(202);
    expect(parseProvider).toHaveBeenCalledWith("docling");
    expect(txInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://app.example/api/files/123",
      }),
    );
    expect(txUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://app.example/api/files/123",
      }),
    );
    expect(triggerDocumentProcessing).toHaveBeenCalledWith(
      "https://app.example/api/files/123",
      "Contract",
      "10",
      "user-1",
      55,
      "contracts",
      expect.objectContaining({
        preferredProvider: "DOCLING",
        versionId: 77,
      }),
    );
    expect(jobValues).toHaveBeenCalledWith(
      expect.objectContaining({
        documentUrl: "https://app.example/api/files/123",
        primaryProvider: "DOCLING",
      }),
    );
  });

  it("returns 503 before inserting a version when OSS authorization cannot sign", async () => {
    const authorizationError = new UploadAuthorizationError(
      "FILE_ACCESS_TOKEN_SECRET is required",
      503,
    );
    (authorizeInternalFileRef as jest.Mock).mockRejectedValue(
      authorizationError,
    );

    const response = await POST(request(), routeContext());

    expect(response.status).toBe(503);
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
    expect(triggerDocumentProcessing).not.toHaveBeenCalled();
  });
});
