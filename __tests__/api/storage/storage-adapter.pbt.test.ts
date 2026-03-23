/**
 * Property-based tests for the unified Storage Adapter.
 * Feature: local-s3-migration
 */

import * as fc from "fast-check";

// ─── Shared test constants ───────────────────────────────────────────────────

const TEST_ENDPOINT = "http://localhost:8333";
const TEST_BUCKET = "pdr-documents";

// ─── Mock env ────────────────────────────────────────────────────────────────

const mockEnvData = {
  server: {
    NEXT_PUBLIC_STORAGE_PROVIDER: "local" as "cloud" | "local",
    NEXT_PUBLIC_S3_ENDPOINT: TEST_ENDPOINT as string | undefined,
    S3_REGION: "us-east-1",
    S3_ACCESS_KEY: "test-key",
    S3_SECRET_KEY: "test-secret",
    S3_BUCKET_NAME: TEST_BUCKET,
    BLOB_READ_WRITE_TOKEN: "fake-blob-token",
  },
  client: {
    NEXT_PUBLIC_STORAGE_PROVIDER: "local" as "cloud" | "local",
    NEXT_PUBLIC_S3_ENDPOINT: TEST_ENDPOINT as string | undefined,
  },
};

function setProvider(provider: "cloud" | "local") {
  mockEnvData.server.NEXT_PUBLIC_STORAGE_PROVIDER = provider;
  mockEnvData.server.NEXT_PUBLIC_S3_ENDPOINT = provider === "local" ? TEST_ENDPOINT : undefined;
  mockEnvData.client.NEXT_PUBLIC_STORAGE_PROVIDER = provider;
  mockEnvData.client.NEXT_PUBLIC_S3_ENDPOINT = provider === "local" ? TEST_ENDPOINT : undefined;
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

jest.mock("~/server/storage/s3-client", () => ({
  putObject: (...args: unknown[]) => mockPutObject(...args),
  getObjectUrl: (...args: unknown[]) => mockGetObjectUrl(...args),
  deleteObject: (...args: unknown[]) => mockDeleteObject(...args),
}));

// ─── Mock Vercel Blob ────────────────────────────────────────────────────────

const mockPutFile = jest.fn().mockImplementation(({ filename }: { filename: string }) => ({
  url: `https://blob.vercel-storage.com/documents/uuid-${filename}`,
  pathname: `documents/uuid-${filename}`,
  contentType: "application/octet-stream",
}));
const mockFetchBlob = jest.fn().mockResolvedValue(new Response("blob-content"));

jest.mock("~/server/storage/vercel-blob", () => ({
  putFile: (...args: unknown[]) => mockPutFile(...args),
  fetchBlob: (...args: unknown[]) => mockFetchBlob(...args),
}));

jest.mock("@vercel/blob", () => ({
  del: jest.fn().mockResolvedValue(undefined),
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

const providerArb = fc.constantFrom(
  "seaweedfs" as const,
  "vercel_blob" as const,
  "uploadthing" as const,
);

// ─── Helpers ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockPutObject.mockClear().mockResolvedValue(undefined);
  mockGetObjectUrl.mockClear().mockImplementation((key: string) => `${TEST_ENDPOINT}/${TEST_BUCKET}/${key}`);
  mockDeleteObject.mockClear().mockResolvedValue(undefined);
  mockPutFile.mockClear().mockImplementation(({ filename }: { filename: string }) => ({
    url: `https://blob.vercel-storage.com/documents/uuid-${filename}`,
    pathname: `documents/uuid-${filename}`,
    contentType: "application/octet-stream",
  }));
  mockFetchBlob.mockClear().mockResolvedValue(new Response("blob-content"));
  setProvider("local");
});

// Import once — mocks are live via the getter, so module doesn't need re-importing
import {
  uploadFile,
  getFileUrl,
  fetchFile,
  deleteFile,
  StorageError,
  getStorageProvider,
  isLocalStorage,
} from "~/lib/storage";

// ─── Property 5: Upload result shape and persistence consistency ─────────────
// Validates: Requirements 4.4, 4.5, 10.2

describe(
  "Feature: local-s3-migration, Property 5: Upload result shape consistency",
  () => {
    it("local mode: uploadFile returns non-empty url, pathname, and provider='seaweedfs'", async () => {
      setProvider("local");

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
            expect(result.provider).toBe("seaweedfs");
            expect(result.url).toContain(TEST_ENDPOINT);
            expect(result.pathname).toMatch(/^documents\/.+/);
          },
        ),
        { numRuns: 100 },
      );
    });

    it("cloud mode: uploadFile returns non-empty url, pathname, and provider='vercel_blob'", async () => {
      setProvider("cloud");

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
            expect(result.provider).toBe("vercel_blob");
          },
        ),
        { numRuns: 100 },
      );
    });
  },
);

// ─── Property 6: Upload error propagation ────────────────────────────────────
// Validates: Requirement 4.6

describe(
  "Feature: local-s3-migration, Property 6: Upload error propagation",
  () => {
    it("S3 upload errors are wrapped in StorageError with provider name and original message", async () => {
      setProvider("local");

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
              expect(se.provider).toBe("seaweedfs");
              expect(se.message).toContain("seaweedfs");
              expect(se.message).toContain(errorMsg);
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    it("Vercel Blob upload errors are wrapped in StorageError with provider name and original message", async () => {
      setProvider("cloud");

      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 100 }),
          filenameArb,
          dataArb,
          userIdArb,
          async (errorMsg, filename, data, userId) => {
            mockPutFile.mockRejectedValue(new Error(errorMsg));

            try {
              await uploadFile({ filename, data, userId });
              throw new Error("__should_not_reach__");
            } catch (err) {
              if (err instanceof Error && err.message === "__should_not_reach__") {
                throw err;
              }
              expect(err).toBeInstanceOf(StorageError);
              const se = err as InstanceType<typeof StorageError>;
              expect(se.provider).toBe("vercel_blob");
              expect(se.message).toContain("vercel_blob");
              expect(se.message).toContain(errorMsg);
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  },
);

// ─── Property 9: Mixed-provider document retrieval ───────────────────────────
// Validates: Requirements 7.1, 7.3

describe(
  "Feature: local-s3-migration, Property 9: Mixed-provider document retrieval",
  () => {
    it("getFileUrl resolves SeaweedFS keys via endpoint and passes cloud URLs through", () => {
      setProvider("local");

      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 80, unit: "grapheme" }).map(
            (s) => `documents/${s.replace(/[^a-zA-Z0-9_-]/g, "x") || "file"}`,
          ),
          providerArb,
          (key, provider) => {
            if (provider === "seaweedfs") {
              const url = getFileUrl(key, "seaweedfs");
              expect(url).toBe(`${TEST_ENDPOINT}/${key}`);
            } else {
              const url = getFileUrl(key, provider);
              expect(url).toBe(key);
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    it("fetchFile routes SeaweedFS URLs to plain fetch and cloud URLs to fetchBlob", async () => {
      setProvider("local");

      const originalFetch = global.fetch;
      const mockGlobalFetch = jest.fn().mockResolvedValue(new Response("s3-content"));
      global.fetch = mockGlobalFetch;

      try {
        // SeaweedFS URL
        const s3Url = `${TEST_ENDPOINT}/${TEST_BUCKET}/documents/test-file.pdf`;
        await fetchFile(s3Url);
        expect(mockGlobalFetch).toHaveBeenCalledWith(s3Url, undefined);

        mockGlobalFetch.mockClear();

        // Cloud URL — does not start with S3 endpoint, so goes to fetchBlob
        const blobUrl = "https://blob.vercel-storage.com/documents/test.pdf";
        await fetchFile(blobUrl);
        expect(mockFetchBlob).toHaveBeenCalledWith(blobUrl, undefined);
      } finally {
        global.fetch = originalFetch;
      }
    });
  },
);

// ─── Property 10: SeaweedFS retrieval error descriptiveness ──────────────────
// Validates: Requirement 7.4

describe(
  "Feature: local-s3-migration, Property 10: SeaweedFS retrieval error descriptiveness",
  () => {
    it("when SeaweedFS is unreachable, error includes endpoint and 'unavailable'", async () => {
      setProvider("local");
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
              expect(se.provider).toBe("seaweedfs");
              expect(se.message).toContain(TEST_ENDPOINT);
              expect(se.message).toContain("unavailable");
            }
          },
        ),
        { numRuns: 100 },
      );

      global.fetch = originalFetch;
    });
  },
);
