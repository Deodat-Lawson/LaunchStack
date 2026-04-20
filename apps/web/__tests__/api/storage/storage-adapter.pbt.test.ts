/**
 * Property-based tests for the unified Storage Adapter.
 * Feature: s3-or-database storage unification
 */

import * as fc from "fast-check";

// ─── Shared test constants ───────────────────────────────────────────────────

const TEST_ENDPOINT = "http://localhost:8333";
const TEST_BUCKET = "pdr-documents";

// ─── Mock env ────────────────────────────────────────────────────────────────

const mockEnvData = {
  server: {
    NEXT_PUBLIC_STORAGE_PROVIDER: "s3" as "s3" | "database" | undefined,
    NEXT_PUBLIC_S3_ENDPOINT: TEST_ENDPOINT as string | undefined,
    S3_REGION: "us-east-1",
    S3_ACCESS_KEY: "test-key",
    S3_SECRET_KEY: "test-secret",
    S3_BUCKET_NAME: TEST_BUCKET,
    BLOB_READ_WRITE_TOKEN: "fake-blob-token",
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
const mockEnsureBucketExists = jest.fn().mockResolvedValue(undefined);

jest.mock("~/server/storage/s3-client", () => ({
  putObject: (...args: unknown[]) => (mockPutObject as (...a: unknown[]) => unknown)(...args),
  getObjectUrl: (key: string) => mockGetObjectUrl(key),
  deleteObject: (...args: unknown[]) => (mockDeleteObject as (...a: unknown[]) => unknown)(...args),
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

jest.mock("~/server/db/schema", () => ({
  fileUploads: { id: "id" },
}));

jest.mock("drizzle-orm", () => ({
  eq: jest.fn((...args: unknown[]) => args),
}));

// ─── Mock Vercel Blob (legacy read-path compat only) ─────────────────────────

const mockFetchBlob = jest.fn().mockResolvedValue(new Response("blob-content"));
const mockIsPrivateBlobUrl = jest.fn((url: string) => url.includes(".private.blob."));

jest.mock("~/server/storage/vercel-blob", () => ({
  fetchBlob: (...args: unknown[]) => mockFetchBlob(...args),
  isPrivateBlobUrl: (...args: unknown[]) => mockIsPrivateBlobUrl(...(args as [string])),
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
  mockEnsureBucketExists.mockClear().mockResolvedValue(undefined);
  mockInsertReturning.mockClear().mockImplementation(() => Promise.resolve([{ id: 42 }]));
  mockFetchBlob.mockClear().mockResolvedValue(new Response("blob-content"));
  setProvider("s3");
});

import {
  uploadFile,
  getFileUrl,
  fetchFile,
  StorageError,
  resolveStorageBackend,
  isS3Storage,
} from "~/lib/storage";

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
