const TEST_ENDPOINT = "http://localhost:8333";
const TEST_BUCKET = "pdr-documents";

const mockListObjectsPrivileged = jest.fn();

jest.mock("server-only", () => ({}));

/** JWT-shaped token whose payload carries appId, which is how the location id is derived. */
function uploadThingTokenFor(appId: string): string {
  const payload = Buffer.from(JSON.stringify({ appId })).toString("base64url");
  return `header.${payload}.signature`;
}

const mockEnvData = {
  server: {
    NEXT_PUBLIC_S3_ENDPOINT: TEST_ENDPOINT,
    S3_BUCKET_NAME: TEST_BUCKET,
    BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_store-alpha_token-v1",
    UPLOADTHING_TOKEN: "",
  },
  client: {
    NEXT_PUBLIC_S3_ENDPOINT: TEST_ENDPOINT,
  },
};

jest.mock("~/env", () => ({
  get env() {
    return mockEnvData;
  },
}));

const mockListFiles = jest.fn();

jest.mock("uploadthing/server", () => ({
  UTApi: class {
    listFiles = (...args: unknown[]) => mockListFiles(...args);
  },
}));

jest.mock("~/server/storage/adapters/s3-adapter", () => ({
  getS3StorageAdapter: () => ({
    listObjectsPrivileged: mockListObjectsPrivileged,
  }),
}));

jest.mock("~/server/db", () => ({
  db: {
    select: jest.fn(),
  },
}));

import { listObjectsPrivileged } from "~/server/storage/inventory";

describe("listObjectsPrivileged", () => {
  beforeEach(() => {
    mockListObjectsPrivileged.mockReset();
    mockListFiles.mockReset();
    mockEnvData.server.UPLOADTHING_TOKEN = "";
  });

  it("reports unavailable — not blocked — when UploadThing is simply not configured", async () => {
    // The env mock leaves UPLOADTHING_TOKEN empty. A deployment that does not
    // use UploadThing has nothing to list, which is "unknown", not "a config
    // error a human must fix". C3's audit treats unavailable as unknown and
    // must not mistake it for zero orphans.
    const result = await listObjectsPrivileged({
      adapter: "uploadthing",
      storageLocationId: "uploadthing:app_test@us-east-1",
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected unavailable error");

    expect(result.error.kind).toBe("unavailable");
    expect(result.error.code).toBe("uploadthing_token_missing");
    expect(mockListFiles).not.toHaveBeenCalled();
  });

  it("returns blocked when storage location id mismatches active adapter identity", async () => {
    const result = await listObjectsPrivileged({
      adapter: "s3",
      storageLocationId: "s3:http://different-endpoint@different-bucket",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected blocked error");
    }

    expect(result.error.kind).toBe("blocked");
    expect(result.error.code).toBe("storage_location_mismatch");
    expect(mockListObjectsPrivileged).not.toHaveBeenCalled();
  });

  it("lists S3 objects with canonical refs and pagination cursor", async () => {
    mockListObjectsPrivileged.mockResolvedValue({
      objects: [
        {
          key: "documents/a.pdf",
          size: 123,
          lastModified: "2026-01-01T00:00:00.000Z",
          etag: '"etag-a"',
        },
      ],
      nextCursor: "next-1",
    });

    const result = await listObjectsPrivileged({
      adapter: "s3",
      storageLocationId: `s3:${TEST_ENDPOINT}@${TEST_BUCKET}`,
      prefix: "documents/",
      cursor: "cursor-1",
      limit: 10,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected success result");
    }

    expect(result.nextCursor).toBe("next-1");
    expect(result.objects).toEqual([
      {
        key: "documents/a.pdf",
        ref: {
          adapter: "s3",
          storageLocationId: `s3:${TEST_ENDPOINT}@${TEST_BUCKET}`,
          key: "documents/a.pdf",
        },
        size: 123,
        lastModified: "2026-01-01T00:00:00.000Z",
        etag: '"etag-a"',
      },
    ]);
  });

  describe("uploadthing listing (C5)", () => {
    const APP_ID = "app_test";
    const LOCATION = `uploadthing:${APP_ID}`;

    beforeEach(() => {
      mockEnvData.server.UPLOADTHING_TOKEN = uploadThingTokenFor(APP_ID);
    });

    it("lists files as canonical refs and pages by offset", async () => {
      mockListFiles.mockResolvedValueOnce({
        files: [
          { key: "file-key-1", size: 1024, uploadedAt: 1700000000000 },
          { key: "file-key-2", size: 2048, uploadedAt: 1700000001000 },
        ],
        hasMore: true,
      });

      const result = await listObjectsPrivileged({
        adapter: "uploadthing",
        storageLocationId: LOCATION,
        limit: 2,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("Expected a successful listing");

      expect(result.objects).toHaveLength(2);
      expect(result.objects[0]).toMatchObject({
        key: "file-key-1",
        ref: { adapter: "uploadthing", storageLocationId: LOCATION, key: "file-key-1" },
        size: 1024,
      });
      // uploadedAt arrives as epoch ms, not a Date.
      expect(result.objects[0]?.lastModified).toBe(new Date(1700000000000).toISOString());

      // The cursor is the next offset, kept opaque to callers.
      expect(result.nextCursor).toBe("2");
      expect(mockListFiles).toHaveBeenCalledWith({ limit: 2, offset: 0 });
    });

    it("stops paging when the provider says there is no more", async () => {
      mockListFiles.mockResolvedValueOnce({ files: [{ key: "only" }], hasMore: false });

      const result = await listObjectsPrivileged({
        adapter: "uploadthing",
        storageLocationId: LOCATION,
        cursor: "40",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("Expected a successful listing");
      expect(result.nextCursor).toBeUndefined();
      expect(mockListFiles).toHaveBeenCalledWith({ limit: 200, offset: 40 });
    });

    it("refuses a prefix rather than silently ignoring it", async () => {
      // Ignoring the prefix would hand back objects the caller did not ask
      // for, and let an audit believe it had scanned a narrower set than it
      // really did.
      const result = await listObjectsPrivileged({
        adapter: "uploadthing",
        storageLocationId: LOCATION,
        prefix: "documents/",
      });

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("Expected prefix to be refused");
      expect(result.error.kind).toBe("invalid_request");
      expect(mockListFiles).not.toHaveBeenCalled();
    });

    it("blocks a location from a different UploadThing app", async () => {
      const result = await listObjectsPrivileged({
        adapter: "uploadthing",
        storageLocationId: "uploadthing:some-other-app",
      });

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("Expected a location mismatch");
      expect(result.error.code).toBe("storage_location_mismatch");
      expect(mockListFiles).not.toHaveBeenCalled();
    });

    it("separates a permanent auth failure from a transient one", async () => {
      mockListFiles.mockRejectedValueOnce(new Error("Unauthorized"));
      const blocked = await listObjectsPrivileged({
        adapter: "uploadthing",
        storageLocationId: LOCATION,
      });
      expect(blocked.ok).toBe(false);
      if (!blocked.ok) expect(blocked.error.kind).toBe("blocked");

      mockListFiles.mockRejectedValueOnce(new Error("ETIMEDOUT"));
      const retryable = await listObjectsPrivileged({
        adapter: "uploadthing",
        storageLocationId: LOCATION,
      });
      expect(retryable.ok).toBe(false);
      if (!retryable.ok) expect(retryable.error.kind).toBe("retryable");
    });
  });
});
