import { POST as uploadPost } from "~/app/api/storage/upload/route";
import { POST as presignPost } from "~/app/api/storage/presign/route";
import { POST as presignCompletePost } from "~/app/api/storage/presign/complete/route";

import { auth } from "@clerk/nextjs/server";
import { isS3Storage } from "~/lib/storage";
import { validateRequestBody } from "~/lib/validation";
import { resolveStorageLocationId } from "~/lib/storage-location-id";
import { resolveActiveCompanyForUser } from "~/lib/active-workspace";
import { createStorageWritePort } from "~/server/storage/write-port";
import { registerUploadArtifact } from "~/server/services/storage-manifest";
import { db } from "~/server/db";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
}));

jest.mock("~/lib/storage", () => ({
  isS3Storage: jest.fn(),
}));

jest.mock("~/lib/validation", () => ({
  validateRequestBody: jest.fn(),
  PresignUploadSchema: {},
  PresignCompleteSchema: {},
}));

jest.mock("~/lib/storage-location-id", () => ({
  resolveStorageLocationId: jest.fn(),
}));

jest.mock("~/lib/active-workspace", () => ({
  resolveActiveCompanyForUser: jest.fn(),
}));

jest.mock("~/server/storage/write-port", () => ({
  createStorageWritePort: jest.fn(),
}));

jest.mock("~/server/services/storage-manifest", () => ({
  registerUploadArtifact: jest.fn(),
}));

jest.mock("~/server/db", () => ({
  db: {
    select: jest.fn(),
    transaction: jest.fn(),
  },
}));

describe("storage write routes migration", () => {
  const mockPut = jest.fn();
  const mockMintRef = jest.fn();
  const mockGetSignedUrl = jest.fn();
  const mockGetBucketName = jest.fn();

  const txInsertReturning = jest.fn();
  const txInsertValues = jest.fn(() => ({ returning: txInsertReturning }));
  const txInsert = jest.fn(() => ({ values: txInsertValues }));

  beforeEach(() => {
    jest.clearAllMocks();

    (auth as unknown as jest.Mock).mockResolvedValue({ userId: "user-123" });
    (isS3Storage as jest.Mock).mockReturnValue(true);
    (resolveStorageLocationId as jest.Mock).mockReturnValue("s3:http://localhost:8333@pdr-documents");
    (resolveActiveCompanyForUser as jest.Mock).mockResolvedValue(42n);

    (createStorageWritePort as jest.Mock).mockReturnValue({
      put: mockPut,
      mintRef: mockMintRef,
      getSignedUrl: mockGetSignedUrl,
      getBucketName: mockGetBucketName,
    });

    (registerUploadArtifact as jest.Mock).mockResolvedValue({ id: 9001 });

    (db.select as jest.Mock).mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue([{ id: 7, companyId: 42 }]),
      }),
    });

    (db.transaction as jest.Mock).mockImplementation(async (cb: (tx: { insert: typeof txInsert }) => Promise<unknown>) => {
      return cb({
        insert: txInsert,
      });
    });

    txInsertReturning.mockResolvedValue([{ id: 314 }]);
    mockGetBucketName.mockReturnValue("pdr-documents");
    mockMintRef.mockImplementation((key: string) => ({
      adapter: "s3",
      storageLocationId: "s3:http://localhost:8333@pdr-documents",
      key,
    }));
    mockGetSignedUrl.mockImplementation(({ ref }: { ref: { key: string } }) => `http://localhost:8333/pdr-documents/${ref.key}?sig=abc`);
    mockPut.mockImplementation(({ key }: { key: string }) => ({
      ref: {
        adapter: "s3",
        storageLocationId: "s3:http://localhost:8333@pdr-documents",
        key,
      },
      url: `http://localhost:8333/pdr-documents/${key}`,
      pathname: key,
      provider: "s3",
    }));
  });

  it("/api/storage/upload delegates writes through storage port put()", async () => {
    const formData = new FormData();
    formData.set("file", new File([Buffer.from("hello")], "hello.pdf", { type: "application/pdf" }));

    const req = new Request("http://localhost/api/storage/upload", {
      method: "POST",
      body: formData,
    });

    const response = await uploadPost(req);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(createStorageWritePort).toHaveBeenCalledTimes(1);
    expect(mockPut).toHaveBeenCalledTimes(1);
    expect(mockPut.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        contentType: "application/pdf",
      }),
    );

    expect(registerUploadArtifact).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        ref: expect.objectContaining({ adapter: "s3" }),
        fileUploadId: 314,
        sourceOperation: "storage-upload",
      }),
    );

    expect(json.ref.adapter).toBe("s3");
    expect(json.bucket).toBe("pdr-documents");
  });

  it("presign -> complete flow keeps ref identity consistent", async () => {
    (validateRequestBody as jest.Mock)
      .mockResolvedValueOnce({
        success: true,
        data: {
          filename: "demo.pdf",
          contentType: "application/pdf",
        },
      });

    const presignReq = new Request("http://localhost/api/storage/presign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: "demo.pdf", contentType: "application/pdf" }),
    });

    const presignResponse = await presignPost(presignReq);
    const presignJson = await presignResponse.json();

    expect(presignResponse.status).toBe(200);
    expect(mockMintRef).toHaveBeenCalledTimes(1);
    expect(mockGetSignedUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        ref: presignJson.ref,
        operation: "put",
        contentType: "application/pdf",
      }),
    );

    (validateRequestBody as jest.Mock)
      .mockResolvedValueOnce({
        success: true,
        data: {
          ref: presignJson.ref,
          filename: "demo.pdf",
          contentType: "application/pdf",
          sizeBytes: 123,
        },
      });

    const completeReq = new Request("http://localhost/api/storage/presign/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ref: presignJson.ref,
        filename: "demo.pdf",
        contentType: "application/pdf",
        sizeBytes: 123,
      }),
    });

    const completeResponse = await presignCompletePost(completeReq);
    const completeJson = await completeResponse.json();

    expect(completeResponse.status).toBe(200);
    expect(registerUploadArtifact).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        ref: presignJson.ref,
        sourceOperation: "presign-complete",
      }),
    );
    expect(completeJson.success).toBe(true);
  });
});
