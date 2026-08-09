import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  postJson,
  forbiddenFetch,
  startApp,
  testConfig,
  type TestServer,
} from "./helpers.js";

describe("URL origin allowlist (SSRF hardening)", () => {
  let server: TestServer;
  const outboundCalls: string[] = [];

  beforeAll(async () => {
    server = await startApp(
      testConfig({ doclingServeUrl: "http://docling.test:5001" }),
      { fetchImpl: forbiddenFetch(outboundCalls) },
    );
  });
  afterAll(async () => {
    await server.close();
  });

  async function expectUrlNotAllowed(
    route: "/route" | "/convert",
    url: string,
  ): Promise<void> {
    const body =
      route === "/route"
        ? { schemaVersion: 1, documentUrl: url }
        : { schemaVersion: 1, url };
    const res = await postJson(server.url, route, body);
    expect(res.status).toBe(400);
    const payload = (await res.json()) as {
      error: { code: string; traceId?: string };
    };
    expect(payload.error.code).toBe("url-not-allowed");
    expect(payload.error.traceId).toBeTruthy();
  }

  it("rejects origins outside the allowlist on /route", async () => {
    await expectUrlNotAllowed("/route", "http://evil.test/doc.pdf");
  });

  it("rejects origins outside the allowlist on /convert", async () => {
    await expectUrlNotAllowed("/convert", "http://evil.test/doc.pdf");
  });

  it("rejects the cloud metadata endpoint", async () => {
    await expectUrlNotAllowed(
      "/route",
      "http://169.254.169.254/latest/meta-data/",
    );
    await expectUrlNotAllowed(
      "/convert",
      "http://169.254.169.254/latest/meta-data/",
    );
  });

  it("rejects file: URLs (non-http scheme)", async () => {
    await expectUrlNotAllowed("/route", "file:///etc/passwd");
    await expectUrlNotAllowed("/convert", "file:///etc/passwd");
  });

  it("rejects ftp: URLs", async () => {
    await expectUrlNotAllowed("/route", "ftp://files.test/doc.pdf");
  });

  it("treats a different port as a different origin", async () => {
    await expectUrlNotAllowed("/route", "http://files.test:8080/doc.pdf");
  });

  it("rejects even when a preferredProvider shortcut would skip the fetch", async () => {
    const res = await postJson(server.url, "/route", {
      schemaVersion: 1,
      documentUrl: "http://evil.test/doc.pdf",
      preferredProvider: "DOCLING",
    });
    expect(res.status).toBe(400);
    const payload = (await res.json()) as { error: { code: string } };
    expect(payload.error.code).toBe("url-not-allowed");
  });

  it("never performed an outbound fetch for any rejected URL", () => {
    expect(outboundCalls).toEqual([]);
  });
});
