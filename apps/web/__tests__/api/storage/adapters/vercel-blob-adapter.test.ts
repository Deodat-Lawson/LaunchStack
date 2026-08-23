/**
 * C4 — Vercel Blob adapter unit tests.
 *
 * The provider SDK is mocked, deliberately. There are no Blob credentials in
 * CI or on a dev machine, so the choice is between mocking the SDK and testing
 * nothing at all. What is under test here is *our* logic — ref minting, the
 * stale-location guard, outcome classification, the bulk-delete fallback — and
 * none of that needs a real network call to be meaningful.
 *
 * What these tests deliberately do NOT prove: that @vercel/blob behaves the
 * way the mocks say it does. That is what the mock asserts, not what it
 * verifies. Real-provider behaviour is only ever confirmed by running against
 * a real store.
 */

jest.mock("~/env", () => ({
  get env() {
    return { server: {}, client: {} };
  },
}));

const mockPut = jest.fn();
const mockGet = jest.fn();
const mockDel = jest.fn();
const mockHead = jest.fn();

class MockBlobNotFoundError extends Error {
  constructor() {
    super("blob not found");
    this.name = "BlobNotFoundError";
  }
}

jest.mock("@vercel/blob", () => ({
  put: (...args: unknown[]) => mockPut(...args),
  get: (...args: unknown[]) => mockGet(...args),
  del: (...args: unknown[]) => mockDel(...args),
  head: (...args: unknown[]) => mockHead(...args),
  BlobNotFoundError: MockBlobNotFoundError,
}));

/**
 * Imported fresh in beforeEach rather than statically.
 *
 * The adapter caches whether the store is public or private in module scope —
 * one probe per process, copied from the original vercel-blob.ts. That cache
 * is correct in production (a long-lived process, one store) but it leaks
 * across tests: whichever test runs first decides the access mode for every
 * test after it, so the fallback path becomes unreachable and the suite
 * silently depends on its own ordering.
 *
 * jest.resetModules() gives each test its own copy of that state.
 */
type CreateVercelBlobAdapter =
  typeof import("~/server/storage/adapters/vercel-blob-adapter").createVercelBlobAdapter;

let createVercelBlobAdapter: CreateVercelBlobAdapter;

const TOKEN = "vercel_blob_rw_store-alpha_secret";
const LOCATION = "vercel-blob:store-alpha";

function refFor(key: string, location = LOCATION) {
  return { adapter: "vercel-blob" as const, storageLocationId: location, key };
}

function streamOf(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

describe("vercel-blob adapter", () => {
  // process.env is shared by every test file that runs in the same jest
  // worker. One test here deletes BLOB_READ_WRITE_TOKEN deliberately, and a
  // deletion that outlives this file would silently change the environment
  // another file runs in.
  const originalBlobToken = process.env.BLOB_READ_WRITE_TOKEN;

  afterAll(() => {
    if (originalBlobToken === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
    else process.env.BLOB_READ_WRITE_TOKEN = originalBlobToken;
  });

  beforeEach(async () => {
    jest.resetModules();

    // resetAllMocks, not clearAllMocks: clearAllMocks only forgets calls, it
    // leaves queued mockResolvedValueOnce values in place. An unconsumed
    // queued value from one test then answers the next test's first call —
    // which is exactly how a test asserting "this should reject" ended up
    // resolving with the previous test's payload.
    jest.resetAllMocks();

    process.env.BLOB_READ_WRITE_TOKEN = TOKEN;
    ({ createVercelBlobAdapter } = await import(
      "~/server/storage/adapters/vercel-blob-adapter"
    ));
  });

  describe("put", () => {
    it("mints a ref whose key is the provider's pathname, not a URL", async () => {
      mockPut.mockResolvedValueOnce({
        url: "https://store-alpha.public.blob.vercel-storage.com/documents/x.pdf",
        pathname: "documents/x.pdf",
        contentType: "application/pdf",
      });

      const result = await createVercelBlobAdapter().put({
        filename: "x.pdf",
        data: Buffer.from("bytes"),
        contentType: "application/pdf",
      });

      // The key is what the provider called it. Nothing is parsed out of a URL.
      expect(result.ref).toEqual(refFor("documents/x.pdf"));
      expect(result.provider).toBe("vercel-blob");
    });

    it("falls back to a private write when the store rejects a public one", async () => {
      mockPut
        .mockRejectedValueOnce(new Error("this is a private store"))
        .mockResolvedValueOnce({
          url: "https://store-alpha.private.blob.vercel-storage.com/documents/y.pdf",
          pathname: "documents/y.pdf",
        });

      const result = await createVercelBlobAdapter().put({
        filename: "y.pdf",
        data: Buffer.from("bytes"),
      });

      expect(mockPut).toHaveBeenCalledTimes(2);
      expect(mockPut.mock.calls[0]?.[2]).toMatchObject({ access: "public" });
      expect(mockPut.mock.calls[1]?.[2]).toMatchObject({ access: "private" });
      expect(result.ref.key).toBe("documents/y.pdf");
    });

    it("probes only once per process, then reuses the cached access mode", async () => {
      // The first write discovers the store is private; the second must not
      // pay for that discovery again.
      mockPut
        .mockRejectedValueOnce(new Error("this is a private store"))
        .mockResolvedValueOnce({ url: "https://s/a.pdf", pathname: "documents/a.pdf" })
        .mockResolvedValueOnce({ url: "https://s/b.pdf", pathname: "documents/b.pdf" });

      const adapter = createVercelBlobAdapter();
      await adapter.put({ filename: "a.pdf", data: Buffer.from("b") });
      await adapter.put({ filename: "b.pdf", data: Buffer.from("b") });

      // Three calls total, not four: one failed probe plus two real writes.
      expect(mockPut).toHaveBeenCalledTimes(3);
      expect(mockPut.mock.calls[2]?.[2]).toMatchObject({ access: "private" });
    });

    it("rethrows any error that is not the private-store signal", async () => {
      mockPut.mockRejectedValueOnce(new Error("quota exceeded"));

      await expect(
        createVercelBlobAdapter().put({ filename: "z.pdf", data: Buffer.from("b") }),
      ).rejects.toThrow("quota exceeded");

      // One attempt only — a real failure must not be retried as "private".
      expect(mockPut).toHaveBeenCalledTimes(1);
    });
  });

  describe("get", () => {
    it("streams the object and resolves the pathname through the SDK", async () => {
      mockGet.mockResolvedValueOnce({
        statusCode: 200,
        stream: streamOf("file contents"),
        headers: new Headers({ "content-type": "application/pdf" }),
      });

      const response = await createVercelBlobAdapter().get(refFor("documents/x.pdf"));

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("application/pdf");
      expect(await response.text()).toBe("file contents");

      // The pathname went to the SDK as-is; no URL was constructed anywhere.
      expect(mockGet).toHaveBeenCalledWith("documents/x.pdf", expect.objectContaining({ token: TOKEN }));
    });

    it("returns 404 rather than throwing when the blob is gone", async () => {
      mockGet.mockRejectedValueOnce(new MockBlobNotFoundError());

      const response = await createVercelBlobAdapter().get(refFor("documents/missing.pdf"));

      // Callers check response.ok, exactly as they do with fetch today.
      expect(response.status).toBe(404);
    });

    it("refuses a ref minted against a different store (Decision 4)", async () => {
      await expect(
        createVercelBlobAdapter().get(refFor("documents/x.pdf", "vercel-blob:retired-store")),
      ).rejects.toThrow(/does not match the configured store/);

      // Critically: it never reached the provider, so it could not have read
      // a same-pathname object out of the current store.
      expect(mockGet).not.toHaveBeenCalled();
    });

    it("rejects a ref belonging to another adapter", async () => {
      await expect(
        createVercelBlobAdapter().get({
          adapter: "s3",
          storageLocationId: "s3:endpoint@bucket",
          key: "documents/x.pdf",
        }),
      ).rejects.toThrow(/received a ref for adapter "s3"/);
    });
  });

  describe("delete", () => {
    it("reports deleted on success", async () => {
      mockDel.mockResolvedValueOnce(undefined);

      const result = await createVercelBlobAdapter().delete(refFor("documents/x.pdf"));

      expect(result).toEqual({ ref: refFor("documents/x.pdf"), outcome: "deleted" });
    });

    it("blocks a stale-location ref without calling the provider", async () => {
      const result = await createVercelBlobAdapter().delete(
        refFor("documents/x.pdf", "vercel-blob:retired-store"),
      );

      expect(result.outcome).toBe("blocked");
      expect(result.errorCode).toBe("storage_location_mismatch");
      expect(mockDel).not.toHaveBeenCalled();
    });

    it("classifies an auth failure as blocked and anything else as retryable", async () => {
      mockDel.mockRejectedValueOnce(new Error("Unauthorized: invalid token"));
      const blocked = await createVercelBlobAdapter().delete(refFor("documents/a.pdf"));
      expect(blocked.outcome).toBe("blocked");

      mockDel.mockRejectedValueOnce(new Error("socket hang up"));
      const retryable = await createVercelBlobAdapter().delete(refFor("documents/b.pdf"));
      expect(retryable.outcome).toBe("retryable");
    });

    it("blocks when the token is missing entirely", async () => {
      delete process.env.BLOB_READ_WRITE_TOKEN;

      const result = await createVercelBlobAdapter().delete(refFor("documents/x.pdf"));

      expect(result.outcome).toBe("blocked");
      expect(mockDel).not.toHaveBeenCalled();
    });
  });

  describe("deleteMany", () => {
    it("deletes in one bulk call when every ref is valid", async () => {
      mockDel.mockResolvedValueOnce(undefined);

      const refs = [refFor("documents/a.pdf"), refFor("documents/b.pdf")];
      const results = await createVercelBlobAdapter().deleteMany(refs);

      expect(mockDel).toHaveBeenCalledTimes(1);
      expect(mockDel).toHaveBeenCalledWith(
        ["documents/a.pdf", "documents/b.pdf"],
        expect.objectContaining({ token: TOKEN }),
      );
      expect(results.every((r) => r.outcome === "deleted")).toBe(true);
    });

    it("retries individually when the bulk call fails, so outcomes stay per-ref", async () => {
      // Bulk fails, then the two individual retries: one works, one does not.
      mockDel
        .mockRejectedValueOnce(new Error("bulk failed"))
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error("socket hang up"));

      const results = await createVercelBlobAdapter().deleteMany([
        refFor("documents/a.pdf"),
        refFor("documents/b.pdf"),
      ]);

      // The point of the fallback: a partial failure is reported as partial,
      // not as total failure (design doc A7).
      expect(results.map((r) => r.outcome).sort()).toEqual(["deleted", "retryable"]);
    });

    it("keeps a stale-location ref out of the bulk call entirely", async () => {
      mockDel.mockResolvedValueOnce(undefined);

      const results = await createVercelBlobAdapter().deleteMany([
        refFor("documents/good.pdf"),
        refFor("documents/stale.pdf", "vercel-blob:retired-store"),
      ]);

      // Only the valid key is sent — otherwise the stale ref's pathname would
      // be deleted out of the *current* store.
      expect(mockDel).toHaveBeenCalledWith(["documents/good.pdf"], expect.anything());
      expect(results.find((r) => r.ref.key === "documents/stale.pdf")?.outcome).toBe("blocked");
    });
  });

  describe("getSignedUrl", () => {
    it("returns the public URL for a public store", async () => {
      mockHead.mockResolvedValueOnce({
        url: "https://store-alpha.public.blob.vercel-storage.com/documents/x.pdf",
      });

      const url = await createVercelBlobAdapter().getSignedUrl(refFor("documents/x.pdf"));

      expect(url).toBe("https://store-alpha.public.blob.vercel-storage.com/documents/x.pdf");
    });
  });
});
