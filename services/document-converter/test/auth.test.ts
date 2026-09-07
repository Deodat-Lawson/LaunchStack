import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
    TEST_API_KEY,
    getJson,
    postJson,
    startApp,
    testConfig,
    type TestServer,
} from "./helpers.js";

describe("X-API-Key auth (fail closed, like sidecar/app/auth.py)", () => {
    let server: TestServer;

    beforeAll(async () => {
        server = await startApp(testConfig());
    });
    afterAll(async () => {
        await server.close();
    });

    it("GET /health is open (docker healthcheck sends no headers)", async () => {
        const res = await getJson(server.url, "/health", null);
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ status: "ok" });
    });

    it("rejects a missing key with the typed envelope", async () => {
        const res = await postJson(
            server.url,
            "/route",
            { schemaVersion: 1, documentUrl: "http://files.test/a.pdf" },
            null
        );
        expect(res.status).toBe(401);
        const body = (await res.json()) as {
            error: { code: string; message: string; traceId?: string };
        };
        expect(body.error.code).toBe("unauthorized");
        expect(body.error.traceId).toBeTruthy();
    });

    it("rejects a mismatched key", async () => {
        const res = await getJson(server.url, "/readyz", "wrong-key");
        expect(res.status).toBe(401);
    });

    it("rejects an empty key header", async () => {
        const res = await getJson(server.url, "/readyz", "");
        expect(res.status).toBe(401);
    });

    it("accepts the configured key", async () => {
        const res = await getJson(server.url, "/readyz", TEST_API_KEY);
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({
            status: "ready",
            docling: "not-configured",
        });
    });

    it("fails closed when the configured key is unset/empty", async () => {
        // loadConfig refuses to produce such a config; build one directly to
        // prove the middleware ALSO fails closed on its own.
        const open = await startApp(testConfig({ apiKey: "" }));
        try {
            const withHeader = await getJson(open.url, "/readyz", "anything");
            expect(withHeader.status).toBe(401);
            const withEmpty = await getJson(open.url, "/readyz", "");
            expect(withEmpty.status).toBe(401);
        } finally {
            await open.close();
        }
    });

    it("echoes a caller-provided X-Trace-Id on 401s", async () => {
        const res = await fetch(server.url + "/readyz", {
            headers: { "X-Trace-Id": "trace-123" },
        });
        expect(res.status).toBe(401);
        expect(res.headers.get("x-trace-id")).toBe("trace-123");
        const body = (await res.json()) as { error: { traceId?: string } };
        expect(body.error.traceId).toBe("trace-123");
    });
});
