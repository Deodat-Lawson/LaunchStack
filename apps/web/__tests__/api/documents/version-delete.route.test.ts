const mockAuth = jest.fn();
const mockResolveActiveCompanyForUser = jest.fn();

const mockDeleteFileByRef = jest.fn();
const mockDeleteFileByUrl = jest.fn();
const mockPromoteLegacyUrlToRef = jest.fn();

const selectQueue: unknown[] = [];
const mockDbSelect = jest.fn((_arg?: unknown) => ({
  from: () => ({
    where: () => Promise.resolve((selectQueue.shift() as unknown[]) ?? []),
  }),
}));
const mockDbDeleteWhere = jest.fn();
const mockDbDelete = jest.fn((_arg?: unknown) => ({
  where: (...args: unknown[]) => mockDbDeleteWhere(...args),
}));

jest.mock("@clerk/nextjs/server", () => ({
  auth: () => mockAuth(),
}));

jest.mock("~/lib/active-workspace", () => ({
  resolveActiveCompanyForUser: (...args: unknown[]) =>
    mockResolveActiveCompanyForUser(...args),
}));

jest.mock("~/lib/rate-limit-middleware", () => ({
  withRateLimit: async (
    _request: Request,
    _preset: unknown,
    handler: () => Promise<Response>,
  ) => handler(),
}));

jest.mock("~/lib/rate-limiter", () => ({
  RateLimitPresets: { strict: "strict" },
}));

jest.mock("~/lib/storage", () => ({
  deleteFileByRef: (...args: unknown[]) => mockDeleteFileByRef(...args),
  // Exported only so this test can explicitly assert the legacy path is unused.
  deleteFileByUrl: (...args: unknown[]) => mockDeleteFileByUrl(...args),
}));

jest.mock("~/server/storage/legacy-promote", () => ({
  promoteLegacyUrlToRef: (...args: unknown[]) =>
    mockPromoteLegacyUrlToRef(...args),
}));

jest.mock("~/server/db", () => ({
  db: {
    select: (arg?: unknown) => mockDbSelect(arg),
    delete: (arg?: unknown) => mockDbDelete(arg),
  },
}));

jest.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => args,
  eq: (...args: unknown[]) => args,
}));

jest.mock("@launchstack/core/db/schema", () => ({
  users: { userId: "users.userId", role: "users.role", id: "users.id", companyId: "users.companyId" },
  document: { id: "document.id", companyId: "document.companyId", currentVersionId: "document.currentVersionId" },
  documentVersions: {
    id: "documentVersions.id",
    documentId: "documentVersions.documentId",
    versionNumber: "documentVersions.versionNumber",
    url: "documentVersions.url",
  },
}));

import { DELETE } from "~/app/api/documents/[id]/versions/[versionId]/route";

function queueHappyPathRows() {
  selectQueue.push(
    [{ id: 101, userId: "user-1", role: "owner", companyId: 7n }],
    [{ id: 10, companyId: 7n, currentVersionId: 99n }],
    [{ id: 20, versionNumber: 2, url: "https://utfs.io/f/ut_key_20" }],
    [{ id: 20 }, { id: 21 }],
  );
}

describe("DELETE /api/documents/[id]/versions/[versionId]", () => {
  const originalLifecycleEnv = process.env.STORAGE_DELETION_LIFECYCLE_ENABLED;

  beforeEach(() => {
    jest.clearAllMocks();
    selectQueue.length = 0;
    mockAuth.mockResolvedValue({ userId: "user-1" });
    mockResolveActiveCompanyForUser.mockResolvedValue(7n);
    mockDbDeleteWhere.mockResolvedValue(undefined);
  });

  afterAll(() => {
    process.env.STORAGE_DELETION_LIFECYCLE_ENABLED = originalLifecycleEnv;
  });

  it("returns 503 when lifecycle flag is off and does not touch URL delete path", async () => {
    process.env.STORAGE_DELETION_LIFECYCLE_ENABLED = "0";
    queueHappyPathRows();

    const response = await DELETE(new Request("http://localhost/test", { method: "DELETE" }), {
      params: Promise.resolve({ id: "10", versionId: "20" }),
    });

    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error).toBe("Storage deletion lifecycle is disabled");

    expect(mockDeleteFileByRef).not.toHaveBeenCalled();
    expect(mockDeleteFileByUrl).not.toHaveBeenCalled();
    expect(mockPromoteLegacyUrlToRef).not.toHaveBeenCalled();
    expect(mockDbDelete).not.toHaveBeenCalled();
  });

  it("uses promoted ObjectRef + deleteFileByRef when lifecycle flag is on", async () => {
    process.env.STORAGE_DELETION_LIFECYCLE_ENABLED = "1";
    queueHappyPathRows();

    const promotedRef = {
      adapter: "uploadthing" as const,
      storageLocationId: "uploadthing:app_test@us-east-1",
      key: "ut_key_20",
    };

    mockPromoteLegacyUrlToRef.mockReturnValue({
      ok: true,
      ref: promotedRef,
      confidence: "medium",
    });
    mockDeleteFileByRef.mockResolvedValue({ ref: promotedRef, outcome: "deleted" });

    const response = await DELETE(new Request("http://localhost/test", { method: "DELETE" }), {
      params: Promise.resolve({ id: "10", versionId: "20" }),
    });

    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);

    expect(mockPromoteLegacyUrlToRef).toHaveBeenCalledWith({
      value: "https://utfs.io/f/ut_key_20",
    });
    expect(mockDeleteFileByRef).toHaveBeenCalledWith(promotedRef);
    expect(mockDeleteFileByUrl).not.toHaveBeenCalled();
    expect(mockDbDelete).toHaveBeenCalledTimes(1);
  });
});
