/**
 * Property-based tests for the unified Storage Adapter.
 * Feature: s3-or-database storage unification
 */

import * as fc from "fast-check";

// ─── Shared test constants ───────────────────────────────────────────────────

const TEST_ENDPOINT = "http://localhost:8333";
const TEST_BUCKET = "pdr-documents";

function makeUploadThingToken(appId: string, region?: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" }), "utf8").toString("base64url");
  const payload = Buffer.from(JSON.stringify({ appId, region }), "utf8").toString("base64url");
  return `${header}.${payload}.sig`;
}

const TEST_UPLOADTHING_TOKEN = makeUploadThingToken("app_test", "us-east-1");

// ─── Mock env ────────────────────────────────────────────────────────────────

const mockEnvData = {
  server: {
    NEXT_PUBLIC_STORAGE_PROVIDER: "s3" as "s3" | "database" | undefined,
    NEXT_PUBLIC_S3_ENDPOINT: TEST_ENDPOINT as string | undefined,
    S3_REGION: "us-east-1",
    S3_ACCESS_KEY: "test-key",
    S3_SECRET_KEY: "test-secret",
    S3_BUCKET_NAME: TEST_BUCKET,
    BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_store-alpha_token-v1",
    UPLOADTHING_TOKEN: TEST_UPLOADTHING_TOKEN,
  },
  client: {
    NEXT_PUBLIC_STORAGE_PROVIDER: "s3" as "s3" | "database" | undefined,
    NEXT_PUBLIC_S3_ENDPOINT: TEST_ENDPOINT as string | undefined,
  },
};

function setProvider(provider: "s3" | "database") {
  mockEnvData.server.NEXT_PUBLIC_STORAGE_PROVIDER = provider;
  mockEnvData.server.NEXT_PUBLIC_S3_ENDPOINT = provider === "s3" ? TEST_ENDPOINT : undefined;
  mockEnvData.client.NEXT_PUBLIC_STORAGE_PROVIDER = provider;
  mockEnvData.client.NEXT_PUBLIC_S3_ENDPOINT = provider === "s3" ? TEST_ENDPOINT : undefined;
}

jest.mock("~/env", () => ({
  get env() {
    return mockEnvData;
  },
}));

// ─── Mock S3 client ──────────────────────────────────────────────────────────

const mockPutObject = jest.fn().mockResolvedValue(undefined);
const mockGetObjectUrl = jest.fn((key: string) => `${TEST_ENDPOINT}/${TEST_BUCKET}/${key}`);
const mockDeleteObject = jest.fn().mockResolvedValue(undefined);
const mockDeleteObjects = jest.fn().mockImplementation(async (keys: string[]) =>
  keys.map((key) => ({ key, outcome: "deleted" as const })),
);
const mockEnsureBucketExists = jest.fn().mockResolvedValue(undefined);

jest.mock("~/server/storage/s3-client", () => ({
  putObject: (...args: unknown[]) => (mockPutObject as (...a: unknown[]) => unknown)(...args),
  getObjectUrl: (key: string) => mockGetObjectUrl(key),
  deleteObject: (...args: unknown[]) => (mockDeleteObject as (...a: unknown[]) => unknown)(...args),
  deleteObjects: (...args: unknown[]) => (mockDeleteObjects as (...a: unknown[]) => unknown)(...args),
  ensureBucketExists: () => mockEnsureBucketExists(),
}));

// ─── Mock database ───────────────────────────────────────────────────────────

const mockInsertReturning = jest.fn(() => Promise.resolve([{ id: 42 }]));
const mockDelete = jest.fn().mockResolvedValue(undefined);

jest.mock("~/server/db", () => ({
  db: {
    insert: jest.fn(() => ({
      values: jest.fn(() => ({
        returning: mockInsertReturning,
      })),
    })),
    delete: jest.fn(() => ({
      where: mockDelete,
    })),
  },
}));

jest.mock("@launchstack/core/db/schema", () => ({
  fileUploads: { id: "id" },
}));

jest.mock("drizzle-orm", () => ({
  eq: jest.fn((...args: unknown[]) => args),
}));

// ─── Mock Vercel Blob (legacy read-path compat only) ─────────────────────────

const mockFetchBlob = jest.fn().mockResolvedValue(new Response("blob-content"));
const mockIsPrivateBlobUrl = jest.fn((url: string) => url.includes(".private.blob."));
const mockDeleteBlobFile = jest.fn().mockResolvedValue(undefined);
const mockTargetDelete = jest.fn().mockImplementation(async (ref: unknown) => ({
  ref,
  outcome: "deleted" as const,
}));
const mockTargetDeleteMany = jest.fn().mockImplementation(async (refs: unknown[]) =>
  refs.map((ref) => ({ ref, outcome: "deleted" as const })),
);

jest.mock("~/server/storage/vercel-blob", () => ({
  fetchBlob: (...args: unknown[]) => mockFetchBlob(...args),
  isPrivateBlobUrl: (...args: unknown[]) => mockIsPrivateBlobUrl(...(args as [string])),
  deleteFile: (...args: unknown[]) => mockDeleteBlobFile(...args),
}));

jest.mock("~/server/storage/create-storage-port", () => ({
  createStoragePortTargetFactory: () => ({
    forAdapter: () => ({
      delete: (...args: unknown[]) => mockTargetDelete(...args),
      deleteMany: (...args: unknown[]) => mockTargetDeleteMany(...args),
    }),
  }),
}));

// ─── Mock UploadThing server SDK ────────────────────────────────────────────

const mockUploadThingDeleteFiles = jest.fn().mockResolvedValue({ success: true, deletedCount: 1 });
const mockUploadThingCtor = jest.fn();

jest.mock("uploadthing/server", () => ({
  UTApi: jest.fn().mockImplementation((config: unknown) => {
    mockUploadThingCtor(config);
    return {
      deleteFiles: (...args: unknown[]) => mockUploadThingDeleteFiles(...args),
    };
  }),
}));

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const filenameArb = fc
  .string({ minLength: 1, maxLength: 60, unit: "grapheme" })
  .map((s) => {
    const clean = s.replace(/[^a-zA-Z0-9._-]/g, "x");
    return clean || "file.txt";
  });

const contentTypeArb = fc.constantFrom(
  "application/pdf",
  "image/png",
  "image/jpeg",
  "text/plain",
  "application/octet-stream",
);

const dataArb = fc
  .uint8Array({ minLength: 1, maxLength: 200 })
  .map((arr) => Buffer.from(arr));

const userIdArb = fc.string({ minLength: 1, maxLength: 40, unit: "grapheme" }).map(
  (s) => s.replace(/[^a-zA-Z0-9_-]/g, "u") || "user1",
);

// ─── Helpers ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockPutObject.mockClear().mockResolvedValue(undefined);
  mockGetObjectUrl.mockClear().mockImplementation((key: string) => `${TEST_ENDPOINT}/${TEST_BUCKET}/${key}`);
  mockDeleteObject.mockClear().mockResolvedValue(undefined);
  mockDeleteObjects.mockClear().mockImplementation(async (keys: string[]) =>
    keys.map((key) => ({ key, outcome: "deleted" as const })),
  );
  mockEnsureBucketExists.mockClear().mockResolvedValue(undefined);
  mockInsertReturning.mockClear().mockImplementation(() => Promise.resolve([{ id: 42 }]));
  mockFetchBlob.mockClear().mockResolvedValue(new Response("blob-content"));
  mockDeleteBlobFile.mockClear().mockResolvedValue(undefined);
  mockTargetDelete.mockClear().mockImplementation(async (ref: unknown) => ({
    ref,
    outcome: "deleted" as const,
  }));
  mockTargetDeleteMany.mockClear().mockImplementation(async (refs: unknown[]) =>
    refs.map((ref) => ({ ref, outcome: "deleted" as const })),
  );
  mockUploadThingDeleteFiles.mockClear().mockResolvedValue({ success: true, deletedCount: 1 });
  mockUploadThingCtor.mockClear();
  mockDelete.mockClear().mockResolvedValue(undefined);
  mockEnvData.server.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_store-alpha_token-v1";
  mockEnvData.server.UPLOADTHING_TOKEN = TEST_UPLOADTHING_TOKEN;
  setProvider("s3");
});

import {
  uploadFile,
  deleteFile,
  deleteFileByUrl,
  deleteFileByRef,
  deleteManyByRef,
  getFileUrl,
  fetchFile,
  StorageError,
  resolveStorageBackend,
  isS3Storage,
} from "~/lib/storage";
import { resolveStorageLocationId } from "~/lib/storage-location-id";

// ─── Property 5: Upload result shape and persistence consistency ─────────────

describe(
  "Feature: storage unification, Property 5: Upload result shape consistency",
  () => {
    it("s3 mode: uploadFile returns non-empty url, pathname, and provider='s3'", async () => {
      setProvider("s3");

      await fc.assert(
        fc.asyncProperty(
          filenameArb,
          dataArb,
          contentTypeArb,
          userIdArb,
          async (filename, data, contentType, userId) => {
            const result = await uploadFile({ filename, data, contentType, userId });

            expect(result.url).toBeTruthy();
            expect(result.url.length).toBeGreaterThan(0);
            expect(result.pathname).toBeTruthy();
            expect(result.pathname.length).toBeGreaterThan(0);
            expect(result.provider).toBe("s3");
            expect(result.url).toContain(TEST_ENDPOINT);
            expect(result.pathname).toMatch(/^documents\/.+/);
          },
        ),
        { numRuns: 50 },
      );
    });

    it("database mode: uploadFile returns /api/files/<id> and provider='database'", async () => {
      setProvider("database");

      await fc.assert(
        fc.asyncProperty(
          filenameArb,
          dataArb,
          contentTypeArb,
          userIdArb,
          async (filename, data, contentType, userId) => {
            const result = await uploadFile({ filename, data, contentType, userId });

            expect(result.url).toMatch(/^\/api\/files\/\d+$/);
            expect(result.provider).toBe("database");
            expect(result.pathname).toMatch(/^documents\/.+/);
          },
        ),
        { numRuns: 50 },
      );
    });
  },
);

// ─── Property 6: Upload error propagation ────────────────────────────────────

describe(
  "Feature: storage unification, Property 6: Upload error propagation",
  () => {
    it("S3 upload errors are wrapped in StorageError with provider='s3' and original message", async () => {
      setProvider("s3");

      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 100 }),
          filenameArb,
          dataArb,
          userIdArb,
          async (errorMsg, filename, data, userId) => {
            mockPutObject.mockRejectedValue(new Error(errorMsg));

            try {
              await uploadFile({ filename, data, userId });
              throw new Error("__should_not_reach__");
            } catch (err) {
              if (err instanceof Error && err.message === "__should_not_reach__") {
                throw err;
              }
              expect(err).toBeInstanceOf(StorageError);
              const se = err as InstanceType<typeof StorageError>;
              expect(se.provider).toBe("s3");
              expect(se.message).toContain("s3");
              expect(se.message).toContain(errorMsg);
            }
          },
        ),
        { numRuns: 50 },
      );
    });

    it("Database upload errors are wrapped in StorageError with provider='database' and original message", async () => {
      setProvider("database");

      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 100 }),
          filenameArb,
          dataArb,
          userIdArb,
          async (errorMsg, filename, data, userId) => {
            mockInsertReturning.mockRejectedValue(new Error(errorMsg));

            try {
              await uploadFile({ filename, data, userId });
              throw new Error("__should_not_reach__");
            } catch (err) {
              if (err instanceof Error && err.message === "__should_not_reach__") {
                throw err;
              }
              expect(err).toBeInstanceOf(StorageError);
              const se = err as InstanceType<typeof StorageError>;
              expect(se.provider).toBe("database");
              expect(se.message).toContain("database");
              expect(se.message).toContain(errorMsg);
            }
          },
        ),
        { numRuns: 50 },
      );
    });
  },
);

// ─── Property 9: Mixed-provider document retrieval ───────────────────────────

describe(
  "Feature: storage unification, Property 9: URL resolution and fetching",
  () => {
    it("getFileUrl resolves S3 keys via endpoint and passes /api/files URLs through", () => {
      setProvider("s3");

      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 80, unit: "grapheme" }).map(
            (s) => `documents/${s.replace(/[^a-zA-Z0-9_-]/g, "x") || "file"}`,
          ),
          (key) => {
            const s3Url = getFileUrl(key, "s3");
            expect(s3Url).toBe(`${TEST_ENDPOINT}/${TEST_BUCKET}/${key}`);

            const dbUrl = getFileUrl("/api/files/42", "database");
            expect(dbUrl).toBe("/api/files/42");
          },
        ),
        { numRuns: 50 },
      );
    });

    it("fetchFile routes S3 URLs to plain fetch and legacy private-blob URLs to fetchBlob", async () => {
      setProvider("s3");

      const originalFetch = global.fetch;
      const mockGlobalFetch = jest.fn().mockResolvedValue(new Response("s3-content"));
      global.fetch = mockGlobalFetch;

      try {
        const s3Url = `${TEST_ENDPOINT}/${TEST_BUCKET}/documents/test-file.pdf`;
        await fetchFile(s3Url);
        expect(mockGlobalFetch).toHaveBeenCalledWith(s3Url, undefined);

        mockGlobalFetch.mockClear();

        const privateBlobUrl = "https://store.private.blob.vercel-storage.com/documents/test.pdf";
        await fetchFile(privateBlobUrl);
        expect(mockFetchBlob).toHaveBeenCalledWith(privateBlobUrl, undefined);
      } finally {
        global.fetch = originalFetch;
      }
    });
  },
);

// ─── Property 10: S3 retrieval error descriptiveness ─────────────────────────

describe(
  "Feature: storage unification, Property 10: S3 retrieval error descriptiveness",
  () => {
    it("when S3 is unreachable, error includes endpoint and 'unavailable'", async () => {
      setProvider("s3");
      const originalFetch = global.fetch;

      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 50 }),
          fc.string({ minLength: 1, maxLength: 80, unit: "grapheme" }).map(
            (s) => s.replace(/[^a-zA-Z0-9_.-]/g, "x") || "file.pdf",
          ),
          async (errorMsg, filename) => {
            global.fetch = jest.fn().mockRejectedValue(new Error(errorMsg));

            const url = `${TEST_ENDPOINT}/${TEST_BUCKET}/documents/${filename}`;

            try {
              await fetchFile(url);
              throw new Error("__should_not_reach__");
            } catch (err) {
              if (err instanceof Error && err.message === "__should_not_reach__") {
                throw err;
              }
              expect(err).toBeInstanceOf(StorageError);
              const se = err as InstanceType<typeof StorageError>;
              expect(se.provider).toBe("s3");
              expect(se.message).toContain(TEST_ENDPOINT);
              expect(se.message).toContain("unavailable");
            }
          },
        ),
        { numRuns: 50 },
      );

      global.fetch = originalFetch;
    });
  },
);

// ─── Property 11: Backend resolution ─────────────────────────────────────────

describe(
  "Feature: storage unification, Property 11: Backend resolution",
  () => {
    it("resolveStorageBackend honors explicit setting", () => {
      setProvider("s3");
      expect(resolveStorageBackend()).toBe("s3");
      expect(isS3Storage()).toBe(true);

      setProvider("database");
      expect(resolveStorageBackend()).toBe("database");
      expect(isS3Storage()).toBe(false);
    });
  },
);

// ─── Property 12: S3 put/delete key identity ────────────────────────────────

describe(
  "Feature: storage unification, Property 12: S3 put/delete key identity",
  () => {
    it("direct S3 deleteFile promotes a full object URL before deleting", async () => {
      setProvider("s3");
      const key = "documents/direct-url.pdf";
      const url = `${TEST_ENDPOINT}/${TEST_BUCKET}/${key}`;

      await deleteFile(url, "s3");

      expect(mockDeleteObject).toHaveBeenCalledWith(key);
    });

    it("direct S3 deleteFile preserves an opaque key", async () => {
      setProvider("s3");
      const key = "documents/opaque-key.pdf";

      await deleteFile(key, "s3");

      expect(mockDeleteObject).toHaveBeenCalledWith(key);
    });

    it("direct S3 deleteFile rejects a URL from another origin", async () => {
      setProvider("s3");

      await expect(
        deleteFile("https://evil.example/pdr-documents/documents/file.pdf", "s3"),
      ).rejects.toBeInstanceOf(StorageError);

      expect(mockDeleteObject).not.toHaveBeenCalled();
    });

    it("deleteFileByUrl strips endpoint and bucket, never sending duplicated bucket in DeleteObject Key", async () => {
      setProvider("s3");

      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 80, unit: "grapheme" }).map(
            (s) => `documents/${s.replace(/[^a-zA-Z0-9._-]/g, "x") || "file"}`,
          ),
          async (key) => {
            const url = `${TEST_ENDPOINT}/${TEST_BUCKET}/${key}`;
            await deleteFileByUrl(url);

            expect(mockTargetDelete).toHaveBeenCalled();
            const calledRef = mockTargetDelete.mock.calls.at(-1)?.[0] as { key: string };
            const expectedFromUrl = new URL(url).pathname.replace(`/${TEST_BUCKET}/`, "").replace(/^\/+/, "");
            expect(calledRef.key).toBe(expectedFromUrl);
            expect(calledRef.key.startsWith(`${TEST_BUCKET}/`)).toBe(false);
            expect(calledRef.key.includes(`${TEST_BUCKET}/${TEST_BUCKET}/`)).toBe(false);
          },
        ),
        { numRuns: 50 },
      );
    });

    it("upload/delete round-trip uses the exact same S3 object key", async () => {
      setProvider("s3");

      await fc.assert(
        fc.asyncProperty(
          filenameArb,
          dataArb,
          contentTypeArb,
          userIdArb,
          async (filename, data, contentType, userId) => {
            const uploaded = await uploadFile({ filename, data, contentType, userId });

            const putKey = mockPutObject.mock.calls.at(-1)?.[0] as string;
            expect(putKey).toBeTruthy();

            await deleteFileByUrl(uploaded.url);

            const deleteRef = mockTargetDelete.mock.calls.at(-1)?.[0] as { key: string };
            expect(deleteRef.key).toBe(putKey);
          },
        ),
        { numRuns: 50 },
      );
    });
  },
);

describe("Feature: blob deletion routing and identity", () => {
  it("deleteFileByUrl routes Blob URLs to vercel-blob adapter and never falls through to /api/files database path", async () => {
    const blobUrl = "https://store.public.blob.vercel-storage.com/api/files/4242";

    await deleteFileByUrl(blobUrl);

    expect(mockTargetDelete).toHaveBeenCalledTimes(1);
    expect(mockTargetDelete).toHaveBeenCalledWith(
      expect.objectContaining({
        adapter: "vercel-blob",
        key: "api/files/4242",
      }),
    );
    expect(mockDeleteBlobFile).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("token rotation within the same Blob store keeps the same storageLocationId", () => {
    mockEnvData.server.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_store-stable_token-v1";
    const first = resolveStorageLocationId("vercel-blob");

    mockEnvData.server.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_store-stable_token-v2";
    const second = resolveStorageLocationId("vercel-blob");

    expect(first).toBe("vercel-blob:store-stable");
    expect(second).toBe(first);
  });

  it("token for a different Blob store mints a new location id and blocks deletes for old refs", async () => {
    mockEnvData.server.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_store-old_token-v1";
    const oldLocationId = resolveStorageLocationId("vercel-blob");

    const oldRef = {
      adapter: "vercel-blob" as const,
      storageLocationId: oldLocationId,
      key: "documents/legacy-file.pdf",
    };

    mockEnvData.server.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_store-new_token-v2";
    const newLocationId = resolveStorageLocationId("vercel-blob");
    expect(newLocationId).toBe("vercel-blob:store-new");
    expect(newLocationId).not.toBe(oldLocationId);

    const result = await deleteFileByRef(oldRef);
    expect(result.outcome).toBe("blocked");
    expect(result.errorCode).toBe("storage_location_mismatch");
    expect(mockTargetDelete).not.toHaveBeenCalled();
    expect(mockDeleteBlobFile).not.toHaveBeenCalled();
  });
});

describe("Feature: database deletion by canonical URL", () => {
  it("deleteFileByUrl('/api/files/{id}') deletes the matching fileUploads row only", async () => {
    await deleteFileByUrl("/api/files/4242");

    expect(mockDelete).toHaveBeenCalledTimes(1);
    expect(mockDelete).toHaveBeenCalledWith(["id", 4242]);
    expect(mockDelete).not.toHaveBeenCalledWith(["id", 9999]);

    expect(mockDeleteBlobFile).not.toHaveBeenCalled();
    expect(mockDeleteObject).not.toHaveBeenCalled();
  });

  it("unknown/non-matching URLs are rejected (no silent fallthrough)", async () => {
    await expect(deleteFileByUrl("/api/files/not-a-number")).rejects.toBeInstanceOf(StorageError);

    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockDeleteBlobFile).not.toHaveBeenCalled();
    expect(mockDeleteObject).not.toHaveBeenCalled();
  });
});

describe("Feature: UploadThing adapter routing", () => {
  it("UTFS URL delete routes to uploadthing adapter only (no S3/blob/database fallthrough)", async () => {
    const key = "doc_UTFS_key_123";
    const utfsUrl = `https://utfs.io/f/${key}`;

    await deleteFileByUrl(utfsUrl);

    expect(mockTargetDelete).toHaveBeenCalledWith(
      expect.objectContaining({
        adapter: "uploadthing",
        key,
      }),
    );
    expect(mockUploadThingCtor).not.toHaveBeenCalled();
    expect(mockUploadThingDeleteFiles).not.toHaveBeenCalled();
    expect(mockDeleteObject).not.toHaveBeenCalled();
    expect(mockDeleteBlobFile).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("uploadthing delete round-trip by ref returns deleted outcome", async () => {
    const ref = {
      adapter: "uploadthing" as const,
      storageLocationId: "uploadthing:app_test@us-east-1",
      key: "ut_key_roundtrip_1",
    };

    const result = await deleteFileByRef(ref);

    expect(result).toEqual({ ref, outcome: "deleted" });
    expect(mockTargetDelete).toHaveBeenCalledWith(ref);
    expect(mockUploadThingDeleteFiles).not.toHaveBeenCalled();
    expect(mockDeleteObject).not.toHaveBeenCalled();
    expect(mockDeleteBlobFile).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
  });
});

describe("Feature: adapter acceptance failure matrix (provider slice)", () => {
  it("transient adapter errors return retryable (no false success)", async () => {
    const ref = {
      adapter: "vercel-blob" as const,
      storageLocationId: "vercel-blob:store-alpha",
      key: "documents/transient.pdf",
    };

    mockTargetDelete.mockRejectedValueOnce(new Error("ECONNRESET: upstream transient network failure"));

    const result = await deleteFileByRef(ref);

    expect(result.outcome).toBe("retryable");
    expect(result.outcome).not.toBe("deleted");
  });

  it("permanent auth/config errors return blocked (distinct from retryable)", async () => {
    const ref = {
      adapter: "uploadthing" as const,
      storageLocationId: "uploadthing:app_test@us-east-1",
      key: "ut_blocked_1",
    };

    mockTargetDelete.mockResolvedValueOnce({
      ref,
      outcome: "blocked",
      errorCode: "uploadthing_auth_or_config_error",
      message: "Unauthorized: token is invalid",
    });

    const result = await deleteFileByRef(ref);

    expect(result.outcome).toBe("blocked");
    expect(result.errorCode).toBe("uploadthing_auth_or_config_error");
    expect(result.outcome).not.toBe("retryable");
  });

  it("missing object is reported as not_found under adapter contract", async () => {
    const ref = {
      adapter: "uploadthing" as const,
      storageLocationId: "uploadthing:app_test@us-east-1",
      key: "ut_missing_1",
    };

    mockTargetDelete.mockResolvedValueOnce({ ref, outcome: "not_found" });

    const result = await deleteFileByRef(ref);
    expect(result).toEqual({ ref, outcome: "not_found" });
  });

  it("deleteMany preserves per-item outcomes on partial failures", async () => {
    const refs = [
      {
        adapter: "s3" as const,
        storageLocationId: "s3:http://localhost:8333@pdr-documents",
        key: "documents/a.pdf",
      },
      {
        adapter: "s3" as const,
        storageLocationId: "s3:http://localhost:8333@pdr-documents",
        key: "documents/b.pdf",
      },
      {
        adapter: "s3" as const,
        storageLocationId: "s3:http://localhost:8333@pdr-documents",
        key: "documents/c.pdf",
      },
    ];

    mockTargetDeleteMany.mockResolvedValueOnce([
      { ref: refs[0], outcome: "deleted", errorCode: undefined, message: undefined },
      { ref: refs[1], outcome: "not_found", errorCode: undefined, message: undefined },
      {
        ref: refs[2],
        outcome: "retryable",
        errorCode: "SlowDown",
        message: "Please reduce your request rate.",
      },
    ]);

    const results = await deleteManyByRef(refs);

    expect(results).toEqual([
      { ref: refs[0], outcome: "deleted", errorCode: undefined, message: undefined },
      { ref: refs[1], outcome: "not_found", errorCode: undefined, message: undefined },
      {
        ref: refs[2],
        outcome: "retryable",
        errorCode: "SlowDown",
        message: "Please reduce your request rate.",
      },
    ]);
  });

  it("rejected outcomes are preserved and never remapped to another adapter", async () => {
    const legacyRef = {
      adapter: "legacy" as unknown as "s3",
      storageLocationId: "legacy:v1",
      key: "legacy://opaque",
    } as unknown as Parameters<typeof deleteFileByRef>[0];

    const result = await deleteFileByRef(legacyRef);

    expect(result.outcome).toBe("rejected");
    expect(result.errorCode).toBe("unsupported_adapter");
    expect(mockDeleteObject).not.toHaveBeenCalled();
    expect(mockDeleteBlobFile).not.toHaveBeenCalled();
    expect(mockUploadThingDeleteFiles).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
  });
});
