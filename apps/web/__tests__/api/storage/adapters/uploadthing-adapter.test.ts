/**
 * C4 — UploadThing adapter unit tests.
 *
 * UTApi is mocked for the same reason the Blob SDK is: no credentials exist
 * in CI, and what is worth testing is our own classification and guard logic.
 */

const mockEnvData = { server: {} as { UPLOADTHING_TOKEN?: string }, client: {} };

jest.mock("~/env", () => ({
  get env() {
    return mockEnvData;
  },
}));

const mockDeleteFiles = jest.fn();
const mockGenerateSignedURL = jest.fn();

jest.mock("uploadthing/server", () => ({
  UTApi: class {
    deleteFiles = (...args: unknown[]) => mockDeleteFiles(...args);
    generateSignedURL = (...args: unknown[]) => mockGenerateSignedURL(...args);
  },
}));

import { createUploadThingAdapter } from "~/server/storage/adapters/uploadthing-adapter";

/**
 * A JWT-shaped token whose payload carries appId, which is how
 * parseUploadThingIdentityFromToken derives the location id.
 */
function tokenFor(appId: string): string {
  const payload = Buffer.from(JSON.stringify({ appId })).toString("base64url");
  return `header.${payload}.signature`;
}

const APP_ID = "app-alpha";
const LOCATION = `uploadthing:${APP_ID}`;

function refFor(key: string, location = LOCATION) {
  return { adapter: "uploadthing" as const, storageLocationId: location, key };
}

describe("uploadthing adapter", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    mockEnvData.server.UPLOADTHING_TOKEN = tokenFor(APP_ID);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("put", () => {
    it("refuses loudly instead of silently writing somewhere else", async () => {
      // The failure mode this prevents: a caller that asked for UploadThing
      // getting its bytes into S3 or Postgres, compiling clean and passing
      // tests, and only surfacing when someone looks for a file that was
      // never there.
      await expect(
        createUploadThingAdapter().put({ filename: "a.pdf", data: Buffer.from("b") }),
      ).rejects.toThrow(/not supported: UploadThing uploads are client-side/);
    });
  });

  describe("delete", () => {
    it("reports deleted when the provider removed a file", async () => {
      mockDeleteFiles.mockResolvedValueOnce({ success: true, deletedCount: 1 });

      const result = await createUploadThingAdapter().delete(refFor("file-key-1"));

      expect(result).toEqual({ ref: refFor("file-key-1"), outcome: "deleted" });
    });

    it("reports not_found when the provider removed nothing", async () => {
      // Unlike Vercel Blob, UploadThing returns a count — so "already gone" is
      // genuinely observable here and is reported rather than assumed.
      mockDeleteFiles.mockResolvedValueOnce({ success: true, deletedCount: 0 });

      const result = await createUploadThingAdapter().delete(refFor("file-key-2"));

      expect(result.outcome).toBe("not_found");
    });

    it("classifies auth failures as blocked and transient ones as retryable", async () => {
      mockDeleteFiles.mockRejectedValueOnce(new Error("Unauthorized"));
      expect((await createUploadThingAdapter().delete(refFor("k1"))).outcome).toBe("blocked");

      mockDeleteFiles.mockRejectedValueOnce(new Error("ETIMEDOUT"));
      expect((await createUploadThingAdapter().delete(refFor("k2"))).outcome).toBe("retryable");
    });

    it("blocks a ref minted against a different app without calling the provider", async () => {
      const result = await createUploadThingAdapter().delete(
        refFor("file-key-1", "uploadthing:some-other-app"),
      );

      expect(result.outcome).toBe("blocked");
      expect(result.errorCode).toBe("storage_location_mismatch");
      expect(mockDeleteFiles).not.toHaveBeenCalled();
    });
  });

  describe("deleteMany", () => {
    it("accepts a bulk result only when the count is a clean sweep", async () => {
      mockDeleteFiles.mockResolvedValueOnce({ success: true, deletedCount: 2 });

      const results = await createUploadThingAdapter().deleteMany([refFor("a"), refFor("b")]);

      expect(mockDeleteFiles).toHaveBeenCalledTimes(1);
      expect(results.every((r) => r.outcome === "deleted")).toBe(true);
    });

    it("falls back per-key when the bulk count is short, rather than guessing", async () => {
      // Bulk says "2 asked, 1 deleted" — but not which. Attributing that
      // not_found to either ref would be a coin flip, so each is re-checked.
      mockDeleteFiles
        .mockResolvedValueOnce({ success: true, deletedCount: 1 })
        .mockResolvedValueOnce({ success: true, deletedCount: 1 })
        .mockResolvedValueOnce({ success: true, deletedCount: 0 });

      const results = await createUploadThingAdapter().deleteMany([refFor("a"), refFor("b")]);

      expect(mockDeleteFiles).toHaveBeenCalledTimes(3);
      expect(results.map((r) => r.outcome)).toEqual(["deleted", "not_found"]);
    });
  });

  describe("get / getSignedUrl", () => {
    it("reads through a presigned URL rather than a hand-built one", async () => {
      mockGenerateSignedURL.mockResolvedValueOnce({ ufsUrl: "https://ufs.example/f/file-key-1?sig=x" });
      const fetchMock = jest.fn().mockResolvedValueOnce(new Response("bytes", { status: 200 }));
      global.fetch = fetchMock as unknown as typeof fetch;

      const response = await createUploadThingAdapter().get(refFor("file-key-1"));

      expect(mockGenerateSignedURL).toHaveBeenCalledWith("file-key-1", undefined);
      expect(fetchMock).toHaveBeenCalledWith("https://ufs.example/f/file-key-1?sig=x", undefined);
      expect(await response.text()).toBe("bytes");
    });

    it("passes expiresIn through when asked", async () => {
      mockGenerateSignedURL.mockResolvedValueOnce({ ufsUrl: "https://ufs.example/f/k?sig=y" });

      const url = await createUploadThingAdapter().getSignedUrl(refFor("k"), { expiresIn: 60 });

      expect(mockGenerateSignedURL).toHaveBeenCalledWith("k", { expiresIn: 60 });
      expect(url).toBe("https://ufs.example/f/k?sig=y");
    });

    it("refuses a stale-location ref before generating anything", async () => {
      await expect(
        createUploadThingAdapter().getSignedUrl(refFor("k", "uploadthing:some-other-app")),
      ).rejects.toThrow(/does not match the configured UploadThing app/);

      expect(mockGenerateSignedURL).not.toHaveBeenCalled();
    });
  });
});
