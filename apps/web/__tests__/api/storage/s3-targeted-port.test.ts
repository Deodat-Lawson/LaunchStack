import type { ObjectRef } from "@launchstack/core/storage";

const STORAGE_LOCATION_ID = "s3:http://localhost:8333@bucket";
const mockPut = jest.fn();
const mockGetObjectUrl = jest.fn();
const mockDeleteObject = jest.fn();
const mockDeleteObjects = jest.fn();
const mockGetSignedUrl = jest.fn();
const mockFetch = jest.fn();

const mockAdapter = {
  put: (...args: unknown[]) => mockPut(...args),
  getObjectUrl: (...args: unknown[]) => mockGetObjectUrl(...args),
  deleteObject: (...args: unknown[]) => mockDeleteObject(...args),
  deleteObjects: (...args: unknown[]) => mockDeleteObjects(...args),
  getSignedUrl: (...args: unknown[]) => mockGetSignedUrl(...args),
  mintRef: jest.fn(),
};

jest.mock("~/server/storage/adapters/s3-adapter", () => ({
  getS3StorageAdapter: () => mockAdapter,
}));

jest.mock("~/lib/storage-location-id", () => ({
  resolveStorageLocationId: jest.fn(() => STORAGE_LOCATION_ID),
}));

import { createS3TargetedPort } from "~/server/storage/adapters/s3-targeted-port";

function makeRef(key = "documents/file.pdf"): ObjectRef {
  return {
    adapter: "s3",
    storageLocationId: STORAGE_LOCATION_ID,
    key,
  };
}

describe("createS3TargetedPort", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockResolvedValue(new Response("file contents"));
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  it("puts an UploadInput through the S3 adapter with a provider key", async () => {
    const ref = makeRef("documents/generated-report.pdf");
    mockPut.mockResolvedValue({
      ref,
      url: "https://objects.example/bucket/documents/generated-report.pdf",
      pathname: ref.key,
      provider: "s3",
    });

    const port = createS3TargetedPort();
    const result = await port.put({
      filename: "generated report.pdf",
      data: new Uint8Array([1, 2, 3]),
      contentType: "application/pdf",
    });

    expect(mockPut).toHaveBeenCalledWith({
      key: expect.stringMatching(/^documents\/[0-9a-f-]+-generated-report\.pdf$/),
      body: Buffer.from([1, 2, 3]),
      contentType: "application/pdf",
    });
    expect(result).toMatchObject({
      ref,
      url: "https://objects.example/bucket/documents/generated-report.pdf",
      pathname: ref.key,
      contentType: "application/pdf",
      provider: "s3",
    });
  });

  it("gets a ref by fetching the S3 object URL", async () => {
    const ref = makeRef();
    const init = { headers: { "if-none-match": "etag-value" } };
    mockGetObjectUrl.mockReturnValue("https://objects.example/bucket/documents/file.pdf");

    const response = await createS3TargetedPort().get(ref, init);

    expect(mockGetObjectUrl).toHaveBeenCalledWith(ref.key);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://objects.example/bucket/documents/file.pdf",
      init,
    );
    expect(response).toBeInstanceOf(Response);
  });

  it("returns a stable deleted outcome after deleting one ref", async () => {
    const ref = makeRef();
    mockDeleteObject.mockResolvedValue(undefined);

    await expect(createS3TargetedPort().delete(ref)).resolves.toEqual({
      ref,
      outcome: "deleted",
    });
    expect(mockDeleteObject).toHaveBeenCalledWith(ref.key);
  });

  it("preserves one outcome per ref for batch deletion", async () => {
    const refs = [makeRef("documents/a.pdf"), makeRef("documents/b.pdf")];
    mockDeleteObjects.mockResolvedValue([
      { key: "documents/a.pdf", outcome: "deleted" },
      {
        key: "documents/b.pdf",
        outcome: "blocked",
        errorCode: "AccessDenied",
        message: "access denied",
      },
    ]);

    await expect(createS3TargetedPort().deleteMany(refs)).resolves.toEqual([
      { ref: refs[0], outcome: "deleted" },
      {
        ref: refs[1],
        outcome: "blocked",
        errorCode: "AccessDenied",
        message: "access denied",
      },
    ]);
    expect(mockDeleteObjects).toHaveBeenCalledWith(["documents/a.pdf", "documents/b.pdf"]);
  });

  it("generates a download signed URL for a ref", async () => {
    const ref = makeRef();
    mockGetSignedUrl.mockResolvedValue("https://signed.example/file.pdf");

    await expect(
      createS3TargetedPort().getSignedUrl(ref, { expiresIn: 600 }),
    ).resolves.toBe("https://signed.example/file.pdf");
    expect(mockGetSignedUrl).toHaveBeenCalledWith({
      ref,
      operation: "get",
      expiresIn: 600,
    });
  });
});
