const mockRegisterObject = jest.fn();
const mockRegisterArtifactEdge = jest.fn();
const mockDbTransaction = jest.fn();
const mockTx = {
  insert: jest.fn(),
};

jest.mock("~/server/db", () => ({
  db: {
    transaction: (...args: unknown[]) => mockDbTransaction(...args),
  },
}));

jest.mock("@launchstack/core/db/schema", () => ({
  document: {
    id: "document.id",
    url: "document.url",
    title: "document.title",
    category: "document.category",
  },
}));

jest.mock("~/server/services/storage-manifest", () => ({
  registerObject: (...args: unknown[]) => mockRegisterObject(...args),
  registerArtifactEdge: (...args: unknown[]) => mockRegisterArtifactEdge(...args),
}));

import type { ObjectRef } from "@launchstack/core/storage";
import { createDocumentRecord } from "~/server/services/create-document";

describe("createDocumentRecord manifest guard", () => {
  beforeEach(() => {
    mockRegisterObject.mockReset();
    mockRegisterArtifactEdge.mockReset();
    mockDbTransaction.mockReset();
    mockTx.insert.mockReset();
  });

  it("registers the uploaded ObjectRef in the same transaction before returning", async () => {
    const ref: ObjectRef = {
      adapter: "s3",
      storageLocationId: "s3:http://localhost:8333@pdr-documents",
      key: "documents/source.pdf",
    };
    const row = { id: 42, url: "https://storage/source.pdf", title: "Source", category: "Legal" };
    const insertedObject = { id: 7 };

    mockTx.insert.mockReturnValue({
      values: jest.fn(() => ({
        returning: jest.fn().mockResolvedValue([row]),
      })),
    });
    mockRegisterObject.mockResolvedValue(insertedObject);
    mockDbTransaction.mockImplementation(async (callback: (tx: typeof mockTx) => Promise<unknown>) => callback(mockTx));

    const result = await createDocumentRecord({
      url: row.url,
      title: row.title,
      category: row.category,
      companyId: BigInt(9),
      ocrEnabled: true,
      ocrProcessed: false,
      storageRef: ref,
      sourceOperation: "document-upload",
    });

    expect(mockRegisterObject).toHaveBeenCalledWith(
      mockTx,
      expect.objectContaining({
        ref,
        companyId: BigInt(9),
        documentId: 42,
        sourceOperation: "document-upload",
      }),
    );
    expect(result).toEqual({ ...row, storageObjectId: 7 });
  });

  it("records a derived artifact edge in the same transaction", async () => {
    const ref: ObjectRef = {
      adapter: "database",
      storageLocationId: "database:primary",
      key: "8",
    };
    const row = { id: 43, url: "/api/files/8", title: "Transcript", category: "Legal" };

    mockTx.insert.mockReturnValue({
      values: jest.fn(() => ({
        returning: jest.fn().mockResolvedValue([row]),
      })),
    });
    mockRegisterObject.mockResolvedValue({ id: 11 });
    mockRegisterArtifactEdge.mockResolvedValue({ id: 12 });
    mockDbTransaction.mockImplementation(async (callback: (tx: typeof mockTx) => Promise<unknown>) => callback(mockTx));

    await createDocumentRecord({
      url: row.url,
      title: row.title,
      category: row.category,
      companyId: BigInt(9),
      ocrEnabled: true,
      ocrProcessed: false,
      storageRef: ref,
      parentObjectId: 4,
      parentEdgeType: "audio-transcript",
    });

    expect(mockRegisterArtifactEdge).toHaveBeenCalledWith(mockTx, {
      parentObjectId: 4,
      childObjectId: 11,
      edgeType: "audio-transcript",
    });
  });
});