/**
 * Property-based tests for S3 client module.
 * Feature: local-s3-migration
 */

import * as fc from "fast-check";

// ─── Mock env before importing s3-client ─────────────────────────────────────

const TEST_ENDPOINT = "http://localhost:8333";
const TEST_BUCKET = "pdr-documents";
const TEST_REGION = "us-east-1";
const TEST_ACCESS_KEY = "test-key";
const TEST_SECRET_KEY = "test-secret";

jest.mock("~/env", () => ({
  env: {
    server: {
      NEXT_PUBLIC_S3_ENDPOINT: TEST_ENDPOINT,
      S3_REGION: TEST_REGION,
      S3_ACCESS_KEY: TEST_ACCESS_KEY,
      S3_SECRET_KEY: TEST_SECRET_KEY,
      S3_BUCKET_NAME: TEST_BUCKET,
      NEXT_PUBLIC_STORAGE_PROVIDER: "s3",
    },
    client: {
      NEXT_PUBLIC_STORAGE_PROVIDER: "s3",
      NEXT_PUBLIC_S3_ENDPOINT: TEST_ENDPOINT,
    },
  },
}));

// Reset the singleton between tests so each test gets a fresh client
beforeEach(() => {
  jest.resetModules();
});

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** Valid S3 object key — mirrors the real format: documents/{uuid}-{filename} */
const s3KeyArb = fc
  .tuple(
    fc.string({ minLength: 1, maxLength: 20, unit: "grapheme" }).map((s) => s.replace(/[^a-z0-9_-]/gi, "a") || "a"),
    fc.string({ minLength: 1, maxLength: 40, unit: "grapheme" }).map((s) => {
      const clean = s.replace(/[^a-z0-9_-]/gi, "f");
      return clean || "file";
    }),
  )
  .map(([prefix, name]) => `documents/${prefix}-${name}`);

/** Valid MIME content type */
const contentTypeArb = fc.constantFrom(
  "application/pdf",
  "image/png",
  "image/jpeg",
  "text/plain",
  "application/octet-stream",
  "application/json",
);

/** Non-empty endpoint URL */
const endpointArb = fc
  .tuple(
    fc.constantFrom("http", "https"),
    fc.string({ minLength: 3, maxLength: 20, unit: "grapheme" }).map((s) => s.replace(/[^a-z0-9]/gi, "x") || "xxx"),
    fc.integer({ min: 1024, max: 65535 }),
  )
  .map(([scheme, host, port]) => `${scheme}://${host}:${port}`);

// ─── Property 3: Presigned URL structure ─────────────────────────────────────
// Validates: Requirement 3.3

describe(
  "Feature: local-s3-migration, Property 3: Presigned URL structure",
  () => {
    it("presigned upload URL contains endpoint, bucket, key, and X-Amz-Signature", async () => {
      // Import fresh for each assertion block
      const { getPresignedUploadUrl } = await import("~/server/storage/s3-client");

      await fc.assert(
        fc.asyncProperty(s3KeyArb, contentTypeArb, async (key, contentType) => {
          const url = await getPresignedUploadUrl(key, contentType);

          // URL should be parseable
          const parsed = new URL(url);

          // Must target the configured endpoint host
          expect(parsed.origin).toBe(TEST_ENDPOINT);

          // Must include the bucket in the path (path-style addressing)
          expect(parsed.pathname).toContain(`/${TEST_BUCKET}/`);

          // Must include the object key in the path
          expect(decodeURIComponent(parsed.pathname)).toContain(key);

          // Must have the AWS signature query parameter
          expect(parsed.searchParams.has("X-Amz-Signature")).toBe(true);
        }),
        { numRuns: 100 },
      );
    });

    it("presigned download URL contains endpoint, bucket, key, and X-Amz-Signature", async () => {
      const { getPresignedDownloadUrl } = await import("~/server/storage/s3-client");

      await fc.assert(
        fc.asyncProperty(s3KeyArb, async (key) => {
          const url = await getPresignedDownloadUrl(key);

          const parsed = new URL(url);
          expect(parsed.origin).toBe(TEST_ENDPOINT);
          expect(parsed.pathname).toContain(`/${TEST_BUCKET}/`);
          expect(decodeURIComponent(parsed.pathname)).toContain(key);
          expect(parsed.searchParams.has("X-Amz-Signature")).toBe(true);
        }),
        { numRuns: 100 },
      );
    });
  },
);

// ─── Property 4: S3 client connection error descriptiveness ──────────────────
// Validates: Requirement 3.4
//
// We mock S3Client.send to throw a controlled error, then verify the
// error-wrapping logic in putObject / deleteObject includes the endpoint URL.

describe(
  "Feature: local-s3-migration, Property 4: S3 client connection error descriptiveness",
  () => {
    it("putObject error includes the configured endpoint URL", async () => {
      const { putObject, getS3Client } = await import("~/server/storage/s3-client");
      const client = getS3Client();
      const originalSend = client.send.bind(client);

      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 100 }),
          s3KeyArb,
          async (errorMsg, key) => {
            client.send = jest.fn().mockRejectedValue(new Error(errorMsg));

            try {
              await putObject(key, Buffer.from("test"));
              // Should not reach here
              expect(true).toBe(false);
            } catch (err) {
              expect(err).toBeInstanceOf(Error);
              const msg = (err as Error).message;
              // Must include the configured endpoint
              expect(msg).toContain(TEST_ENDPOINT);
              // Must include the original error message
              expect(msg).toContain(errorMsg);
              // Must include the key for diagnostics
              expect(msg).toContain(key);
            }
          },
        ),
        { numRuns: 100 },
      );

      client.send = originalSend;
    });

    it("deleteObject error includes the configured endpoint URL", async () => {
      const { deleteObject, getS3Client } = await import("~/server/storage/s3-client");
      const client = getS3Client();
      const originalSend = client.send.bind(client);

      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 100 }),
          s3KeyArb,
          async (errorMsg, key) => {
            client.send = jest.fn().mockRejectedValue(new Error(errorMsg));

            try {
              await deleteObject(key);
              expect(true).toBe(false);
            } catch (err) {
              expect(err).toBeInstanceOf(Error);
              const msg = (err as Error).message;
              expect(msg).toContain(TEST_ENDPOINT);
              expect(msg).toContain(errorMsg);
              expect(msg).toContain(key);
            }
          },
        ),
        { numRuns: 100 },
      );

      client.send = originalSend;
    });
  },
);
