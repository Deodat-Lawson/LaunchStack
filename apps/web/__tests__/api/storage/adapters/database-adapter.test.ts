/**
 * C4 — database adapter unit tests.
 *
 * Drizzle and fetch are mocked here so the adapter's own decisions are what is
 * under test: row-id parsing, the stale-location guard, and — the reason this
 * adapter exists in its current shape — that reads go out as an authenticated
 * internal HTTP call rather than a direct row read.
 *
 * The put/get/delete round trip against a real Postgres belongs in a script
 * run against the local database, the same way the deletion lifecycle was
 * verified. A mocked round trip proves the wiring, not the behaviour.
 */

const mockEnvData = {
  server: { APP_PUBLIC_URL: "https://app.example" as string | undefined },
  client: {},
};

jest.mock("~/env", () => ({
  get env() {
    return mockEnvData;
  },
}));

const mockReturning = jest.fn();
const mockDb = {
  insert: jest.fn(() => ({
    values: jest.fn(() => ({ returning: mockReturning })),
  })),
  delete: jest.fn(() => ({
    where: jest.fn(() => ({ returning: mockReturning })),
  })),
};

jest.mock("~/server/db", () => ({
  get db() {
    return mockDb;
  },
}));

import { createDatabaseAdapter } from "~/server/storage/adapters/database-adapter";

const LOCATION = "database:pdr_file_uploads_v1";

function refFor(key: string, location = LOCATION) {
  return { adapter: "database" as const, storageLocationId: location, key };
}

describe("database adapter", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    mockEnvData.server.APP_PUBLIC_URL = "https://app.example";
    process.env.INTERNAL_SERVICE_TOKEN = "test-internal-token";
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("put", () => {
    it("mints a ref whose key is the file_uploads row id", async () => {
      mockReturning.mockResolvedValueOnce([{ id: 42 }]);

      const result = await createDatabaseAdapter().put({
        filename: "report.pdf",
        data: Buffer.from("bytes"),
        contentType: "application/pdf",
        userId: "user-1",
      });

      expect(result.ref).toEqual(refFor("42"));
      expect(result.url).toBe("/api/files/42");
      expect(result.provider).toBe("database");
    });

    it("attributes engine-initiated writes to system when no user is given", async () => {
      mockReturning.mockResolvedValueOnce([{ id: 7 }]);

      await createDatabaseAdapter().put({ filename: "a.txt", data: Buffer.from("b") });

      const values = (mockDb.insert.mock.results[0]?.value as { values: jest.Mock }).values;
      expect(values).toHaveBeenCalledWith(expect.objectContaining({ userId: "system" }));
    });
  });

  describe("delete", () => {
    it("reports deleted when a row was actually removed", async () => {
      mockReturning.mockResolvedValueOnce([{ id: 42 }]);

      const result = await createDatabaseAdapter().delete(refFor("42"));

      expect(result).toEqual({ ref: refFor("42"), outcome: "deleted" });
    });

    it("reports not_found when the row was already gone", async () => {
      // The whole point of checking the row count. lib/storage.ts's database
      // branch returns success either way, which makes an already-absent
      // object indistinguishable from one this call removed (design doc A7).
      mockReturning.mockResolvedValueOnce([]);

      const result = await createDatabaseAdapter().delete(refFor("999"));

      expect(result.outcome).toBe("not_found");
    });

    it("blocks a malformed key instead of retrying it forever", async () => {
      const result = await createDatabaseAdapter().delete(refFor("not-a-row-id"));

      expect(result.outcome).toBe("blocked");
      expect(result.errorCode).toBe("invalid_database_file_reference");
      expect(mockDb.delete).not.toHaveBeenCalled();
    });

    it("blocks a ref from a different store", async () => {
      const result = await createDatabaseAdapter().delete(refFor("42", "database:retired_store"));

      expect(result.outcome).toBe("blocked");
      expect(result.errorCode).toBe("storage_location_mismatch");
      expect(mockDb.delete).not.toHaveBeenCalled();
    });

    it("treats a database error as retryable", async () => {
      mockReturning.mockRejectedValueOnce(new Error("connection terminated"));

      const result = await createDatabaseAdapter().delete(refFor("42"));

      expect(result.outcome).toBe("retryable");
    });
  });

  describe("deleteMany", () => {
    it("attributes every outcome exactly, from one statement", async () => {
      // SQL can say which rows it removed, so unlike the provider adapters
      // there is no bulk-then-fallback dance and nothing is inferred.
      mockReturning.mockResolvedValueOnce([{ id: 1 }]);

      const results = await createDatabaseAdapter().deleteMany([refFor("1"), refFor("2")]);

      expect(mockDb.delete).toHaveBeenCalledTimes(1);
      expect(results).toEqual([
        { ref: refFor("1"), outcome: "deleted" },
        { ref: refFor("2"), outcome: "not_found" },
      ]);
    });

    it("separates unusable refs from the statement", async () => {
      mockReturning.mockResolvedValueOnce([{ id: 1 }]);

      const results = await createDatabaseAdapter().deleteMany([
        refFor("1"),
        refFor("bad-key"),
        refFor("3", "database:retired_store"),
      ]);

      expect(results.filter((r) => r.outcome === "blocked")).toHaveLength(2);
      expect(results.find((r) => r.ref.key === "1")?.outcome).toBe("deleted");
    });
  });

  describe("get", () => {
    it("calls our own route with internal service credentials", async () => {
      const fetchMock = jest.fn().mockResolvedValueOnce(new Response("bytes", { status: 200 }));
      global.fetch = fetchMock as unknown as typeof fetch;

      const response = await createDatabaseAdapter().get(refFor("42"));

      expect(fetchMock).toHaveBeenCalledWith(
        "https://app.example/api/files/42",
        expect.objectContaining({
          headers: expect.objectContaining({ "x-launchstack-internal": "test-internal-token" }),
        }),
      );
      expect(await response.text()).toBe("bytes");
    });

    it("does not let a caller's headers overwrite the internal credentials", async () => {
      const fetchMock = jest.fn().mockResolvedValueOnce(new Response("bytes"));
      global.fetch = fetchMock as unknown as typeof fetch;

      await createDatabaseAdapter().get(refFor("42"), {
        headers: { "x-launchstack-internal": "attacker-supplied" },
      });

      const passed = fetchMock.mock.calls[0]?.[1] as { headers: Record<string, string> };
      expect(passed.headers["x-launchstack-internal"]).toBe("test-internal-token");
    });

    it("fails loudly when APP_PUBLIC_URL is missing rather than silently reading the row", async () => {
      // A silent fallback to a direct row read would mean two code paths where
      // only one is ever exercised. Dev A chose the HTTP call; if it cannot be
      // made, that is a configuration error, not a reason to do something else.
      mockEnvData.server.APP_PUBLIC_URL = undefined;

      await expect(createDatabaseAdapter().get(refFor("42"))).rejects.toThrow(
        /APP_PUBLIC_URL is required/,
      );
    });
  });

  describe("getSignedUrl", () => {
    it("returns the canonical serve path", async () => {
      const url = await createDatabaseAdapter().getSignedUrl(refFor("42"));

      // Not signed, and documented as such: access is decided by the
      // requester's session at the route, not by anything in the URL.
      expect(url).toBe("https://app.example/api/files/42");
    });
  });
});
