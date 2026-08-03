import {
  authorizeInternalFileRef,
  parseInternalFileId,
  UploadAuthorizationError,
} from "~/server/services/internal-file-ref";
import { configureOcr } from "@launchstack/core/ocr/config";

const mockDbSelect = jest.fn();

jest.mock("~/server/db", () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args) as unknown,
  },
}));

function setupFileQuery(rows: Record<string, unknown>[]) {
  const where = jest.fn().mockResolvedValue(rows);
  const from = jest.fn().mockReturnValue({ where });
  mockDbSelect.mockReturnValueOnce({ from });
}

const COMPANY = BigInt(5);

describe("parseInternalFileId", () => {
  it("recognizes relative and absolute internal file URLs", () => {
    expect(parseInternalFileId("/api/files/123")).toBe(123);
    expect(parseInternalFileId("http://app:3000/api/files/123")).toBe(123);
    expect(parseInternalFileId("https://example.com/api/files/123?t=abc")).toBe(
      123,
    );
  });

  it("returns null for anything else", () => {
    expect(parseInternalFileId("https://cdn.example.com/doc.pdf")).toBeNull();
    expect(parseInternalFileId("/api/files/abc")).toBeNull();
    expect(parseInternalFileId("/api/files/123/extra")).toBeNull();
  });
});

describe("authorizeInternalFileRef", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    configureOcr({ fileAccessTokenSecret: "secret" });
  });

  afterEach(() => {
    configureOcr({});
  });

  it("returns null for external URLs without touching the database", async () => {
    await expect(
      authorizeInternalFileRef("https://cdn.example.com/doc.pdf", COMPANY),
    ).resolves.toBeNull();
    expect(mockDbSelect).not.toHaveBeenCalled();
  });

  it("returns the file id when the workspace owns the row", async () => {
    setupFileQuery([{ companyId: COMPANY }]);

    await expect(
      authorizeInternalFileRef("/api/files/123", COMPANY),
    ).resolves.toBe(123);
  });

  it("rejects a file owned by another company", async () => {
    setupFileQuery([{ companyId: BigInt(999) }]);

    await expect(
      authorizeInternalFileRef("/api/files/123", COMPANY),
    ).rejects.toBeInstanceOf(UploadAuthorizationError);
  });

  it("rejects a row with no company stamp", async () => {
    setupFileQuery([{ companyId: null }]);

    await expect(
      authorizeInternalFileRef("/api/files/123", COMPANY),
    ).rejects.toBeInstanceOf(UploadAuthorizationError);
  });

  it("reports a missing row the same way as a foreign one", async () => {
    setupFileQuery([]);

    await expect(
      authorizeInternalFileRef("/api/files/123", COMPANY),
    ).rejects.toMatchObject({ status: 404 });
  });

  // A caller that claims S3 storage used to keep the internal path intact all
  // the way to the token signer, which then handed the worker a valid
  // capability for another tenant's file.
  it("authorizes an absolute internal URL regardless of declared storage", async () => {
    setupFileQuery([{ companyId: BigInt(999) }]);

    await expect(
      authorizeInternalFileRef("http://app:3000/api/files/123", COMPANY),
    ).rejects.toBeInstanceOf(UploadAuthorizationError);
  });

  it("fails at ingress when the OSS worker has no signing secret", async () => {
    configureOcr({ workerUrl: "http://ocr-worker:8001" });
    setupFileQuery([{ companyId: COMPANY }]);

    await expect(
      authorizeInternalFileRef("/api/files/123", COMPANY),
    ).rejects.toMatchObject({ status: 503 });
  });
});
