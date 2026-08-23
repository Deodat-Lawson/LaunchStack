import { createInMemoryStoragePort } from "@launchstack/core/storage";

describe("createInMemoryStoragePort canonical surface", () => {
  it("preserves object identity across put, signed URL, get, and delete", async () => {
    const port = createInMemoryStoragePort();

    const uploaded = await port.put({
      filename: "hello.txt",
      data: Buffer.from("hello world"),
      contentType: "text/plain",
    });

    const signedUrl = await port.getSignedUrl(uploaded.ref, { expiresIn: 300 });
    expect(signedUrl).toContain(uploaded.ref.key);
    expect(signedUrl).toContain("expiresIn=300");
    expect(port.getObject(uploaded.ref)?.ref).toEqual(uploaded.ref);

    const response = await port.get(uploaded.ref);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("hello world");

    const deleteResult = await port.delete(uploaded.ref);
    expect(deleteResult).toEqual({ ref: uploaded.ref, outcome: "deleted" });
    expect(deleteResult.ref).toEqual(uploaded.ref);

    const afterDelete = await port.get(uploaded.ref);
    expect(afterDelete.status).toBe(404);
  });

  it("fails closed for wrong adapter and storage location without touching the object", async () => {
    const port = createInMemoryStoragePort({
      adapter: "vercel-blob",
      storageLocationId: "vercel-blob:store-alpha",
    });
    const uploaded = await port.put({
      filename: "identity.txt",
      data: Buffer.from("identity"),
      contentType: "text/plain",
    });
    const wrongLocationRef = {
      ...uploaded.ref,
      storageLocationId: "vercel-blob:store-beta",
    };
    const wrongAdapterRef = {
      ...uploaded.ref,
      adapter: "uploadthing" as const,
      storageLocationId: "uploadthing:app-beta",
    };

    expect((await port.get(wrongLocationRef)).status).toBe(404);
    expect((await port.get(wrongAdapterRef)).status).toBe(404);
    expect(await port.delete(wrongLocationRef)).toEqual({
      ref: wrongLocationRef,
      outcome: "not_found",
    });
    expect(await port.delete(wrongAdapterRef)).toEqual({
      ref: wrongAdapterRef,
      outcome: "not_found",
    });
    expect(await port.get(uploaded.ref)).toHaveProperty("status", 200);
    expect(port.getObject(uploaded.ref)?.data.toString()).toBe("identity");
  });

  it("supports explicit adapter targeting through forAdapter", async () => {
    const port = createInMemoryStoragePort({
      adapter: "database",
      storageLocationId: "memory:database",
    });
    const target = port.forAdapter("vercel-blob");

    const uploaded = await target.put({
      filename: "blob.txt",
      data: Buffer.from("blob data"),
      contentType: "text/plain",
    });

    expect(target.adapter).toBe("vercel-blob");
    expect(uploaded.ref.adapter).toBe("vercel-blob");
    expect(uploaded.ref.storageLocationId).toBe("memory:vercel-blob");

    const signedUrl = await target.getSignedUrl(uploaded.ref, { expiresIn: 60 });
    expect(signedUrl).toContain(uploaded.ref.key);
    expect(signedUrl).toContain("expiresIn=60");

    const defaultUploaded = await port.put({
      filename: "database.txt",
      data: Buffer.from("database data"),
      contentType: "text/plain",
    });
    expect(defaultUploaded.ref.adapter).toBe("database");
    expect(defaultUploaded.ref.storageLocationId).toBe("memory:database");
    expect((await target.get(uploaded.ref)).status).toBe(200);

    const defaultIdentityForTarget = {
      ...uploaded.ref,
      adapter: "database" as const,
      storageLocationId: "memory:database",
    };
    expect((await port.get(defaultIdentityForTarget)).status).toBe(404);
    expect(await port.delete(defaultIdentityForTarget)).toEqual({
      ref: defaultIdentityForTarget,
      outcome: "not_found",
    });
    expect((await target.get(uploaded.ref)).status).toBe(200);
  });
});
