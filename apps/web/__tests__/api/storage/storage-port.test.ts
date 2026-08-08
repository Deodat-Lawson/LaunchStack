const mockUploadFile = jest.fn();
const mockFetchFile = jest.fn();
const mockDeleteFileByRef = jest.fn();
const mockDeleteManyByRef = jest.fn();
const mockResolveStorageBackend = jest.fn(() => "s3");
const mockPromoteLegacyUrlToRef = jest.fn();

jest.mock("~/lib/storage", () => ({
  uploadFile: (...args: unknown[]) => mockUploadFile(...args),
  fetchFile: (...args: unknown[]) => mockFetchFile(...args),
  deleteFileByRef: (...args: unknown[]) => mockDeleteFileByRef(...args),
  deleteManyByRef: (...args: unknown[]) => mockDeleteManyByRef(...args),
  resolveStorageBackend: () => mockResolveStorageBackend(),
}));

jest.mock("~/server/storage/legacy-promote", () => ({
  promoteLegacyUrlToRef: (...args: unknown[]) => mockPromoteLegacyUrlToRef(...args),
}));

import type { ObjectRef } from "@launchstack/core/storage";
import { createAppStoragePort } from "~/server/storage/port";

describe("createAppStoragePort", () => {
  beforeEach(() => {
    mockUploadFile.mockReset();
    mockFetchFile.mockReset();
    mockDeleteFileByRef.mockReset();
    mockDeleteManyByRef.mockReset();
    mockPromoteLegacyUrlToRef.mockReset();
    mockResolveStorageBackend.mockReset().mockReturnValue("s3");
  });

  it("deleteRef delegates to deleteFileByRef", async () => {
    const ref: ObjectRef = {
      adapter: "s3",
      storageLocationId: "s3:http://localhost:8333@bucket",
      key: "documents/a.pdf",
    };
    mockDeleteFileByRef.mockResolvedValue({ ref, outcome: "deleted" });

    const port = createAppStoragePort();
    const result = await port.deleteRef(ref);

    expect(mockDeleteFileByRef).toHaveBeenCalledWith(ref);
    expect(result).toEqual({ ref, outcome: "deleted" });
  });

  it("deleteMany delegates to grouped batch helper", async () => {
    const refs: ObjectRef[] = [
      {
        adapter: "s3",
        storageLocationId: "s3:http://localhost:8333@bucket",
        key: "documents/a.pdf",
      },
      {
        adapter: "s3",
        storageLocationId: "s3:http://localhost:8333@bucket",
        key: "documents/b.pdf",
      },
      {
        adapter: "vercel-blob",
        storageLocationId: "vercel-blob:store-alpha",
        key: "documents/c.pdf",
      },
    ];

    mockDeleteManyByRef.mockResolvedValue(refs.map((ref) => ({ ref, outcome: "deleted" as const })));

    const port = createAppStoragePort();
    const result = await port.deleteMany(refs);

    expect(mockDeleteManyByRef).toHaveBeenCalledTimes(1);
    expect(mockDeleteManyByRef).toHaveBeenCalledWith(refs);
    expect(result).toEqual(refs.map((ref) => ({ ref, outcome: "deleted" })));
  });

  it("legacy delete shim promotes and deletes by canonical ref", async () => {
    const ref: ObjectRef = {
      adapter: "uploadthing",
      storageLocationId: "uploadthing:app_test@us-east-1",
      key: "ut_abc",
    };
    mockPromoteLegacyUrlToRef.mockReturnValue({ ok: true, ref, confidence: "medium" });
    mockDeleteFileByRef.mockResolvedValue({ ref, outcome: "deleted" });

    const port = createAppStoragePort();
    await port.delete("https://utfs.io/f/ut_abc");

    expect(mockPromoteLegacyUrlToRef).toHaveBeenCalledWith({ value: "https://utfs.io/f/ut_abc" });
    expect(mockDeleteFileByRef).toHaveBeenCalledWith(ref);
  });
});
