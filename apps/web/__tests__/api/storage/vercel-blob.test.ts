import { del, put } from "@vercel/blob";

const mockEnvData = {
  server: {
    BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_store-alpha_token-v1" as string | undefined,
  },
  client: {},
};

jest.mock("~/env", () => ({
  get env() {
    return mockEnvData;
  },
}));

jest.mock("@vercel/blob", () => ({
  put: jest.fn(),
  del: jest.fn(),
}));

import { deleteFile, deleteFiles, putFile } from "~/server/storage/vercel-blob";

describe("vercel-blob storage adapter", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEnvData.server.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_store-alpha_token-v1";
  });

  it("upload/delete round-trip returns ObjectRef key=pathname and deletes by pathname", async () => {
    (put as jest.Mock).mockResolvedValueOnce({
      url: "https://store.public.blob.vercel-storage.com/documents/test.pdf",
      pathname: "documents/test.pdf",
      contentType: "application/pdf",
      contentHash: "abc123",
    });

    const uploaded = await putFile({
      filename: "test.pdf",
      data: Buffer.from("hello"),
      contentType: "application/pdf",
    });

    expect(uploaded.ref).toEqual({
      adapter: "vercel-blob",
      storageLocationId: "vercel-blob:store-alpha",
      key: "documents/test.pdf",
    });

    await deleteFile(uploaded.ref.key);
    expect(del).toHaveBeenCalledWith("documents/test.pdf", {
      token: "vercel_blob_rw_store-alpha_token-v1",
    });

    await deleteFiles([uploaded.ref.key, "documents/second.pdf"]);
    expect(del).toHaveBeenCalledWith(["documents/test.pdf", "documents/second.pdf"], {
      token: "vercel_blob_rw_store-alpha_token-v1",
    });
  });

  it("fails upload closed when Blob store id cannot be parsed", async () => {
    mockEnvData.server.BLOB_READ_WRITE_TOKEN = "unparseable-token";

    await expect(
      putFile({
        filename: "x.txt",
        data: Buffer.from("x"),
        contentType: "text/plain",
      }),
    ).rejects.toThrow('token.split("_")[3]');

    expect(put).not.toHaveBeenCalled();
  });
});
