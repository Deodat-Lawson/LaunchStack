const mockS3Target = { adapter: "s3", provider: "s3" };
const mockVercelBlobTarget = { adapter: "vercel-blob", provider: "vercel-blob" };
const mockUploadThingTarget = { adapter: "uploadthing", provider: "uploadthing" };

const mockCreateS3TargetedPort = jest.fn(() => mockS3Target);
const mockCreateVercelBlobAdapter = jest.fn(() => mockVercelBlobTarget);
const mockCreateUploadThingAdapter = jest.fn(() => mockUploadThingTarget);

jest.mock("~/server/storage/adapters/s3-targeted-port", () => ({
  createS3TargetedPort: () => mockCreateS3TargetedPort(),
}));

jest.mock("~/server/storage/adapters/vercel-blob-adapter", () => ({
  createVercelBlobAdapter: () => mockCreateVercelBlobAdapter(),
}));

jest.mock("~/server/storage/adapters/uploadthing-adapter", () => ({
  createUploadThingAdapter: () => mockCreateUploadThingAdapter(),
}));

import { createStoragePortTargetFactory } from "~/server/storage/create-storage-port";

describe("createStoragePortTargetFactory", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("resolves each extracted adapter to its targeted port", () => {
    const factory = createStoragePortTargetFactory("database");

    expect(factory.forAdapter("s3")).toBe(mockS3Target);
    expect(factory.forAdapter("vercel-blob")).toBe(mockVercelBlobTarget);
    expect(factory.forAdapter("uploadthing")).toBe(mockUploadThingTarget);
    expect(mockCreateS3TargetedPort).toHaveBeenCalledTimes(1);
    expect(mockCreateVercelBlobAdapter).toHaveBeenCalledTimes(1);
    expect(mockCreateUploadThingAdapter).toHaveBeenCalledTimes(1);
  });

  it("keeps database targeting unwired until the database adapter lands", async () => {
    const target = createStoragePortTargetFactory("database").forAdapter("database");

    expect(target.adapter).toBe("database");
    await expect(
      target.get({
        adapter: "database",
        storageLocationId: "database:pdr_file_uploads_v1",
        key: "42",
      }),
    ).rejects.toThrow("not wired");
  });
});
