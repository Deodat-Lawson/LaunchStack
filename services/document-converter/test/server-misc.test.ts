import { afterEach, describe, expect, it } from "vitest";

import {
  postJson,
  getJson,
  startApp,
  testConfig,
  type TestServer,
} from "./helpers.js";

let server: TestServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe("GET /readyz", () => {
  it("is ready when no docling is configured, and says so", async () => {
    server = await startApp(testConfig());
    const res = await getJson(server.url, "/readyz");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: "ready",
      docling: "not-configured",
    });
  });

  it("is ready when docling answers its health check", async () => {
    server = await startApp(
      testConfig({ doclingServeUrl: "http://docling.test:5001" }),
      { doclingHealth: async () => true },
    );
    const res = await getJson(server.url, "/readyz");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ready", docling: "ok" });
  });

  it("caches a recent successful check instead of re-probing", async () => {
    let calls = 0;
    server = await startApp(
      testConfig({ doclingServeUrl: "http://docling.test:5001" }),
      {
        doclingHealth: async () => {
          calls += 1;
          return true;
        },
      },
    );
    await getJson(server.url, "/readyz");
    await getJson(server.url, "/readyz");
    expect(calls).toBe(1);
  });

  it("is unready when docling is configured but unreachable", async () => {
    server = await startApp(
      testConfig({ doclingServeUrl: "http://docling.test:5001" }),
      {
        doclingHealth: async () => {
          throw new Error("connect ECONNREFUSED");
        },
      },
    );
    const res = await getJson(server.url, "/readyz");
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      status: "unready",
      docling: "unreachable",
    });
  });
});

describe("POST /render-pages", () => {
  it("translates 0-based wire indices to 1-based pdf2pic pages", async () => {
    const seen: number[][] = [];
    server = await startApp(testConfig(), {
      renderPages: async (_pdf, pageNumbers) => {
        seen.push(pageNumbers);
        return [new Uint8Array([9, 9, 9])];
      },
    });
    const res = await postJson(server.url, "/render-pages", {
      schemaVersion: 1,
      buffer: Buffer.from("%PDF-1.4").toString("base64"),
      pageIndices: [0, 2],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      schemaVersion: number;
      images: string[];
    };
    expect(body.schemaVersion).toBe(1);
    expect(body.images).toEqual([
      Buffer.from(new Uint8Array([9, 9, 9])).toString("base64"),
    ]);
    expect(seen).toEqual([[1, 3]]);
  });

  it("rejects an empty pageIndices array", async () => {
    server = await startApp(testConfig());
    const res = await postJson(server.url, "/render-pages", {
      schemaVersion: 1,
      buffer: "aGk=",
      pageIndices: [],
    });
    expect(res.status).toBe(400);
    const payload = (await res.json()) as { error: { code: string } };
    expect(payload.error.code).toBe("invalid-request");
  });

  it("rejects a missing buffer", async () => {
    server = await startApp(testConfig());
    const res = await postJson(server.url, "/render-pages", {
      schemaVersion: 1,
      pageIndices: [0],
    });
    expect(res.status).toBe(400);
  });
});

describe("error envelope plumbing", () => {
  it("unknown routes return the typed envelope with a traceId", async () => {
    server = await startApp(testConfig());
    const res = await getJson(server.url, "/nope");
    expect(res.status).toBe(404);
    const payload = (await res.json()) as {
      error: { code: string; traceId?: string };
    };
    expect(payload.error.code).toBe("not-found");
    expect(payload.error.traceId).toBeTruthy();
  });

  it("malformed JSON bodies return invalid-request", async () => {
    server = await startApp(testConfig());
    const res = await fetch(server.url + "/route", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": "test-api-key",
      },
      body: "{not json",
    });
    expect(res.status).toBe(400);
    const payload = (await res.json()) as { error: { code: string } };
    expect(payload.error.code).toBe("invalid-request");
  });

  it("adopts a body traceId when no header is present", async () => {
    server = await startApp(testConfig());
    const res = await postJson(server.url, "/route", {
      schemaVersion: 1,
      documentUrl: "http://evil.test/x.pdf",
      traceId: "body-trace-42",
    });
    expect(res.status).toBe(400); // url-not-allowed, but with our trace
    expect(res.headers.get("x-trace-id")).toBe("body-trace-42");
    const payload = (await res.json()) as { error: { traceId?: string } };
    expect(payload.error.traceId).toBe("body-trace-42");
  });
});
