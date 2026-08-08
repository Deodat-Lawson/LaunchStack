const TEST_ENDPOINT = "http://localhost:8333";
const TEST_BUCKET = "pdr-documents";

const mockS3Send = jest.fn();

jest.mock("server-only", () => ({}));

jest.mock("~/env", () => ({
  env: {
    server: {
      NEXT_PUBLIC_S3_ENDPOINT: TEST_ENDPOINT,
      S3_BUCKET_NAME: TEST_BUCKET,
      BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_store-alpha_token-v1",
      UPLOADTHING_TOKEN: "",
    },
    client: {
      NEXT_PUBLIC_S3_ENDPOINT: TEST_ENDPOINT,
    },
  },
}));

jest.mock("~/server/storage/s3-client", () => ({
  getS3Client: () => ({ send: mockS3Send }),
  getS3BucketName: () => TEST_BUCKET,
}));

jest.mock("~/server/db", () => ({
  db: {
    select: jest.fn(),
  },
}));

import { listObjectsPrivileged } from "~/server/storage/inventory";

describe("listObjectsPrivileged", () => {
  beforeEach(() => {
    mockS3Send.mockReset();
  });

  it("returns explicit unavailable for adapters without listing support", async () => {
    const result = await listObjectsPrivileged({
      adapter: "uploadthing",
      storageLocationId: "uploadthing:app_test@us-east-1",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected unavailable error");
    }

    expect(result.error.kind).toBe("unavailable");
    expect(result.error.code).toBe("uploadthing_list_unavailable");
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
    expect(mockS3Send).not.toHaveBeenCalled();
  });

  it("lists S3 objects with canonical refs and pagination cursor", async () => {
    mockS3Send.mockResolvedValue({
      Contents: [
        {
          Key: "documents/a.pdf",
          Size: 123,
          LastModified: new Date("2026-01-01T00:00:00.000Z"),
          ETag: '"etag-a"',
        },
      ],
      IsTruncated: true,
      NextContinuationToken: "next-1",
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
});
