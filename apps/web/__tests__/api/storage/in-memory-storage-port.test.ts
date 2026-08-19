import { createInMemoryStoragePort } from "@launchstack/core/storage";

describe("createInMemoryStoragePort canonical surface", () => {
  it("supports put/get/delete via canonical method names", async () => {
    const port = createInMemoryStoragePort();

    const uploaded = await port.put({
      filename: "hello.txt",
      data: Buffer.from("hello world"),
      contentType: "text/plain",
    });

    const response = await port.get(uploaded.ref);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("hello world");

    const deleteResult = await port.delete(uploaded.ref);
    expect(deleteResult).toEqual({ ref: uploaded.ref, outcome: "deleted" });

    const afterDelete = await port.get(uploaded.ref);
    expect(afterDelete.status).toBe(404);
  });

  it("supports explicit adapter targeting through forAdapter", async () => {
    const port = createInMemoryStoragePort();
    const target = port.forAdapter("vercel-blob");

    const uploaded = await target.put({
      filename: "blob.txt",
      data: Buffer.from("blob data"),
      contentType: "text/plain",
    });

    expect(target.adapter).toBe("vercel-blob");
    expect(uploaded.ref.adapter).toBe("vercel-blob");

    const signedUrl = await target.getSignedUrl(uploaded.ref, { expiresIn: 60 });
    expect(signedUrl).toContain(uploaded.ref.key);
    expect(signedUrl).toContain("expiresIn=60");
  });
});
