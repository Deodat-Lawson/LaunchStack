const mockDatabaseTarget = { adapter: "database", provider: "database" };
const mockS3Target = { adapter: "s3", provider: "s3" };
const mockVercelBlobTarget = { adapter: "vercel-blob", provider: "vercel-blob" };
const mockUploadThingTarget = { adapter: "uploadthing", provider: "uploadthing" };

const mockCreateDatabaseAdapter = jest.fn(() => mockDatabaseTarget);
const mockCreateS3TargetedPort = jest.fn(() => mockS3Target);
const mockCreateVercelBlobAdapter = jest.fn(() => mockVercelBlobTarget);
const mockCreateUploadThingAdapter = jest.fn(() => mockUploadThingTarget);

// Without this the real adapter loads, and with it ~/server/db -> engine ->
// ~/env, whose import.meta.url cannot be parsed under babel-jest's CJS
// transform. Same reason the other three are mocked here.
jest.mock("~/server/storage/adapters/database-adapter", () => ({
  createDatabaseAdapter: () => mockCreateDatabaseAdapter(),
}));

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
    expect(factory.forAdapter("database")).toBe(mockDatabaseTarget);
    expect(mockCreateS3TargetedPort).toHaveBeenCalledTimes(1);
    expect(mockCreateVercelBlobAdapter).toHaveBeenCalledTimes(1);
    expect(mockCreateUploadThingAdapter).toHaveBeenCalledTimes(1);
    expect(mockCreateDatabaseAdapter).toHaveBeenCalledTimes(1);
  });

  it("still refuses an adapter it has no implementation for", async () => {
    // Replaces "keeps database targeting unwired until the database adapter
    // lands" — that adapter has now landed (C3), so the assertion it made is
    // no longer true and the case above covers the wiring.
    //
    // What is still worth holding: an adapter with no implementation must
    // fail loudly rather than resolve to whichever backend happens to be
    // primary. That silent misrouting is the whole reason forAdapter() exists,
    // so the guard outlives the specific adapter that used to demonstrate it.
    const target = createStoragePortTargetFactory("database").forAdapter(
      "not-a-real-adapter" as never,
    );

    await expect(
      target.get({
        adapter: "database",
        storageLocationId: "database:pdr_file_uploads_v1",
        key: "42",
      }),
    ).rejects.toThrow("not wired");
  });
});
