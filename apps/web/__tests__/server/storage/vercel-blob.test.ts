/** @jest-environment node */

const mockPut = jest.fn();
jest.mock("~/env", () => ({
    env: { server: { BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_Store1_secret" } },
}));
jest.mock("@vercel/blob", () => ({ put: (...args: unknown[]) => mockPut(...args) }));

import { putFile } from "~/server/storage/vercel-blob";

it("mints a ref using the SDK's actual pathname, including the private-store fallback", async () => {
    mockPut
        .mockRejectedValueOnce(new Error("Cannot use public access on a private store"))
        .mockResolvedValueOnce({
            url: "https://store1.private.blob.vercel-storage.com/documents/sdk-generated-suffix.txt",
            pathname: "documents/sdk-generated-suffix.txt",
            contentType: "text/plain",
        });
    const result = await putFile({
        filename: "notes.txt",
        data: Buffer.from("notes"),
        contentType: "text/plain",
    });
    expect(result.ref).toEqual({
        adapter: "vercel-blob",
        storageLocationId: "vercel-blob:store1",
        key: "documents/sdk-generated-suffix.txt",
    });
    expect(mockPut).toHaveBeenCalledTimes(2);
    expect(mockPut.mock.calls[1]?.[2]).toMatchObject({
        access: "private",
        token: "vercel_blob_rw_Store1_secret",
    });
});
