const mockUploadFile = jest.fn();
const mockFetchFile = jest.fn();
const mockDeleteFileByRef = jest.fn();
const mockDeleteManyByRef = jest.fn();
const mockResolveStorageBackend = jest.fn(() => "s3");
const mockPromoteLegacyUrlToRef = jest.fn();
const mockTargetPut = jest.fn();
const mockTargetGet = jest.fn();
const mockTargetDelete = jest.fn();
const mockTargetDeleteMany = jest.fn();
const mockTargetGetSignedUrl = jest.fn();

const mockTargets = {
  s3: {
    adapter: "s3",
    provider: "s3",
    put: (...args: unknown[]) => mockTargetPut(...args),
    get: (...args: unknown[]) => mockTargetGet(...args),
    delete: (...args: unknown[]) => mockTargetDelete(...args),
    deleteMany: (...args: unknown[]) => mockTargetDeleteMany(...args),
    getSignedUrl: (...args: unknown[]) => mockTargetGetSignedUrl(...args),
  },
  "vercel-blob": {
    adapter: "vercel-blob",
    provider: "vercel-blob",
    put: (...args: unknown[]) => mockTargetPut(...args),
    get: (...args: unknown[]) => mockTargetGet(...args),
    delete: (...args: unknown[]) => mockTargetDelete(...args),
    deleteMany: (...args: unknown[]) => mockTargetDeleteMany(...args),
    getSignedUrl: (...args: unknown[]) => mockTargetGetSignedUrl(...args),
  },
  uploadthing: {
    adapter: "uploadthing",
    provider: "uploadthing",
    put: (...args: unknown[]) => mockTargetPut(...args),
    get: (...args: unknown[]) => mockTargetGet(...args),
    delete: (...args: unknown[]) => mockTargetDelete(...args),
    deleteMany: (...args: unknown[]) => mockTargetDeleteMany(...args),
    getSignedUrl: (...args: unknown[]) => mockTargetGetSignedUrl(...args),
  },
};

const mockForAdapter = jest.fn();

jest.mock("~/lib/storage", () => ({
  uploadFile: (...args: unknown[]) => mockUploadFile(...args),
  fetchFile: (...args: unknown[]) => mockFetchFile(...args),
  deleteFileByRef: (...args: unknown[]) => mockDeleteFileByRef(...args),
  deleteManyByRef: (...args: unknown[]) => mockDeleteManyByRef(...args),
  resolveStorageBackend: () => mockResolveStorageBackend(),
}));

jest.mock("~/server/storage/create-storage-port", () => ({
  createStoragePortTargetFactory: () => ({
    forAdapter: (...args: unknown[]) => mockForAdapter(...args),
  }),
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
    mockTargetPut.mockReset();
    mockTargetGet.mockReset();
    mockTargetDelete.mockReset();
    mockTargetDeleteMany.mockReset();
    mockTargetGetSignedUrl.mockReset();
    mockForAdapter.mockReset().mockImplementation((adapter: keyof typeof mockTargets) => mockTargets[adapter]);
  });

  it("deleteRef delegates to deleteFileByRef", async () => {
    const ref: ObjectRef = {
      adapter: "s3",
      storageLocationId: "s3:http://localhost:8333@bucket",
      key: "documents/a.pdf",
    };
    mockTargetDelete.mockResolvedValue({ ref, outcome: "deleted" });

    const port = createAppStoragePort();
    const result = await port.deleteRef(ref);

    expect(mockForAdapter).toHaveBeenCalledWith("s3");
    expect(mockTargetDelete).toHaveBeenCalledWith(ref);
    expect(result).toEqual({ ref, outcome: "deleted" });
  });

  it("routes the default S3 put through the targeted adapter", async () => {
    const ref: ObjectRef = {
      adapter: "s3",
      storageLocationId: "s3:http://localhost:8333@bucket",
      key: "documents/a.pdf",
    };
    mockTargetPut.mockResolvedValue({ ref, provider: "s3" });

    const port = createAppStoragePort();
    const input = {
      filename: "a.pdf",
      data: Buffer.from("hello"),
      contentType: "application/pdf",
    };
    const result = await port.put(input);

    expect(mockForAdapter).toHaveBeenCalledWith("s3");
    expect(mockTargetPut).toHaveBeenCalledWith(input);
    expect(result.ref).toEqual(ref);
  });

  it("requires explicit forAdapter targeting for fixed-intent Vercel Blob writes", async () => {
    const input = {
      filename: "artifact.md",
      data: Buffer.from("artifact"),
      contentType: "text/markdown",
    };
    const ref: ObjectRef = {
      adapter: "vercel-blob",
      storageLocationId: "vercel-blob:store-alpha",
      key: "documents/artifact.md",
    };
    mockTargetPut.mockResolvedValue({ ref, provider: "vercel-blob" });

    const port = createAppStoragePort();
    await port.forAdapter("vercel-blob").put(input);

    expect(mockForAdapter).toHaveBeenCalledWith("vercel-blob");
    expect(mockTargetPut).toHaveBeenCalledWith(input);
    expect(mockForAdapter).not.toHaveBeenCalledWith("s3");
  });

  it("keeps the default database put on the legacy database helper", async () => {
    mockResolveStorageBackend.mockReturnValue("database");
    const ref: ObjectRef = {
      adapter: "database",
      storageLocationId: "database:pdr_file_uploads_v1",
      key: "123",
    };
    mockUploadFile.mockResolvedValue({ ref, provider: "database" });

    const port = createAppStoragePort();
    const input = {
      filename: "a.pdf",
      data: Buffer.from("hello"),
      contentType: "application/pdf",
    };
    const result = await port.put(input);

    expect(mockUploadFile).toHaveBeenCalledWith({
      ...input,
      userId: "system",
    });
    expect(mockForAdapter).not.toHaveBeenCalled();
    expect(result.ref).toEqual(ref);
  });

  it("routes non-database ref reads through their targeted adapter", async () => {
    const ref: ObjectRef = {
      adapter: "vercel-blob",
      storageLocationId: "vercel-blob:store-alpha",
      key: "documents/a.pdf",
    };
    const response = new Response("blob bytes");
    const init = { headers: { accept: "application/octet-stream" } };
    mockTargetGet.mockResolvedValue(response);

    const result = await createAppStoragePort().get(ref, init);

    expect(mockForAdapter).toHaveBeenCalledWith("vercel-blob");
    expect(mockTargetGet).toHaveBeenCalledWith(ref, init);
    expect(result).toBe(response);
  });

  it("routes signed URL requests through the targeted adapter", async () => {
    const ref: ObjectRef = {
      adapter: "s3",
      storageLocationId: "s3:http://localhost:8333@bucket",
      key: "documents/a.pdf",
    };
    mockTargetGetSignedUrl.mockResolvedValue("https://signed.example/a.pdf");

    const result = await createAppStoragePort().getSignedUrl(ref, { expiresIn: 600 });

    expect(mockForAdapter).toHaveBeenCalledWith("s3");
    expect(mockTargetGetSignedUrl).toHaveBeenCalledWith(ref, { expiresIn: 600 });
    expect(result).toBe("https://signed.example/a.pdf");
  });

  it("routes deleteMany groups through their targeted adapters", async () => {
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

    mockTargetDeleteMany.mockImplementation(async (groupRefs: ObjectRef[]) =>
      groupRefs.map((ref) => ({ ref, outcome: "deleted" as const })),
    );

    const port = createAppStoragePort();
    const result = await port.deleteMany(refs);

    expect(mockForAdapter).toHaveBeenCalledWith("s3");
    expect(mockForAdapter).toHaveBeenCalledWith("vercel-blob");
    expect(mockTargetDeleteMany).toHaveBeenCalledTimes(2);
    expect(result).toEqual(refs.map((ref) => ({ ref, outcome: "deleted" })));
  });

  it("legacy delete shim promotes and deletes by canonical ref", async () => {
    const ref: ObjectRef = {
      adapter: "uploadthing",
      storageLocationId: "uploadthing:app_test@us-east-1",
      key: "ut_abc",
    };
    mockPromoteLegacyUrlToRef.mockReturnValue({ ok: true, ref, confidence: "medium" });
    mockTargetDelete.mockResolvedValue({ ref, outcome: "deleted" });

    const port = createAppStoragePort();
    await port.delete("https://utfs.io/f/ut_abc");

    expect(mockPromoteLegacyUrlToRef).toHaveBeenCalledWith({ value: "https://utfs.io/f/ut_abc" });
    expect(mockForAdapter).toHaveBeenCalledWith("uploadthing");
    expect(mockTargetDelete).toHaveBeenCalledWith(ref);
  });

  it("exposes the targeted adapter surface", () => {
    const port = createAppStoragePort();
    const target = port.forAdapter("vercel-blob");

    expect(target.adapter).toBe("vercel-blob");
    expect(target.provider).toBe("vercel-blob");
  });

  it("resolves database refs through the authenticated file route", async () => {
    mockResolveStorageBackend.mockReturnValue("database");
    const response = new Response("database bytes");
    mockFetchFile.mockResolvedValue(response);
    const ref: ObjectRef = {
      adapter: "database",
      storageLocationId: "database:pdr_file_uploads_v1",
      key: "123",
    };
    const init = { headers: { accept: "application/octet-stream" } };

    const result = await createAppStoragePort().get(ref, init);

    expect(mockFetchFile).toHaveBeenCalledWith("/api/files/123", init);
    expect(result).toBe(response);
  });
});
