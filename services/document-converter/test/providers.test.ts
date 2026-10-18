import { afterEach, describe, expect, it } from "vitest";

import {
    OCR_PROVIDER_ORDER,
    createDoclingProbe,
    defaultProvider,
    forcedOcrProvider,
    ocrProviderOrder,
} from "../src/providers.js";
import { getJson, startApp, testConfig, type TestServer } from "./helpers.js";

const EVERYTHING = testConfig({
    azureEndpoint: "https://azure.test",
    azureKey: "azure-key",
    doclingServeUrl: "http://docling.test:5001",
    landingAiApiKey: "landing-key",
    datalabApiKey: "datalab-key",
});

describe("provider order", () => {
    it("is Azure, then Docling, then Landing AI, then Datalab", () => {
        // The app keeps a copy of this list (packages/conversion
        // ocr-processing/provider-order.ts); its test pins the same order.
        expect(OCR_PROVIDER_ORDER).toEqual(["AZURE", "DOCLING", "LANDING_AI", "DATALAB"]);
        expect(ocrProviderOrder(EVERYTHING, true)).toEqual([
            "AZURE",
            "DOCLING",
            "LANDING_AI",
            "DATALAB",
        ]);
    });

    it("leaves out Docling while docling-serve is not answering", () => {
        expect(ocrProviderOrder(EVERYTHING, false)).toEqual(["AZURE", "LANDING_AI", "DATALAB"]);
    });

    it("puts an available operator pin first and skips one that cannot run", () => {
        expect(ocrProviderOrder({ ...EVERYTHING, defaultProvider: "DOCLING" }, true)).toEqual([
            "DOCLING",
            "AZURE",
            "LANDING_AI",
            "DATALAB",
        ]);
        expect(ocrProviderOrder({ ...EVERYTHING, defaultProvider: "DOCLING" }, false)).toEqual([
            "AZURE",
            "LANDING_AI",
            "DATALAB",
        ]);
    });

    it("falls back to the text layer only when no engine can run", () => {
        expect(defaultProvider(testConfig(), false)).toBe("NATIVE_PDF");
        expect(forcedOcrProvider(testConfig(), false)).toBe("NATIVE_PDF");
        expect(defaultProvider(EVERYTHING, false)).toBe("AZURE");
    });

    it("an operator NATIVE_PDF pin holds for the default, not for forced OCR", () => {
        const pinned = { ...EVERYTHING, defaultProvider: "NATIVE_PDF" as const };
        expect(defaultProvider(pinned, true)).toBe("NATIVE_PDF");
        expect(forcedOcrProvider(pinned, true)).toBe("AZURE");
    });
});

describe("docling probe", () => {
    it("reports not-configured without probing when DOCLING_SERVE_URL is unset", async () => {
        let calls = 0;
        const probe = createDoclingProbe(testConfig(), async () => {
            calls += 1;
            return true;
        });
        expect(await probe()).toBe("not-configured");
        expect(calls).toBe(0);
    });

    it("caches both answers and shares one in-flight probe", async () => {
        let calls = 0;
        let healthy = false;
        const probe = createDoclingProbe(
            testConfig({ doclingServeUrl: "http://docling.test:5001" }),
            async () => {
                calls += 1;
                if (!healthy) throw new Error("ECONNREFUSED");
                return true;
            },
            { okTtlMs: 60_000, failTtlMs: 0 }
        );
        const [a, b] = await Promise.all([probe(), probe()]);
        expect([a, b]).toEqual(["unreachable", "unreachable"]);
        expect(calls).toBe(1);

        healthy = true;
        expect(await probe()).toBe("ok"); // failTtlMs 0: re-probed
        expect(await probe()).toBe("ok"); // cached
        expect(calls).toBe(2);
    });
});

describe("GET /capabilities", () => {
    let server: TestServer | undefined;
    afterEach(async () => {
        await server?.close();
        server = undefined;
    });

    it("lists the engines routing will try, Docling only when it answers", async () => {
        server = await startApp(EVERYTHING, {
            doclingHealth: async () => {
                throw new Error("getaddrinfo ENOTFOUND docling-serve");
            },
        });
        const res = await getJson(server.url, "/capabilities");
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({
            schemaVersion: 1,
            docling: "unreachable",
            ocrOrder: ["AZURE", "LANDING_AI", "DATALAB"],
            defaultProvider: null,
        });
    });

    it("includes Docling when docling-serve is healthy", async () => {
        server = await startApp(
            testConfig({ doclingServeUrl: "http://docling.test:5001", defaultProvider: "DOCLING" }),
            { doclingHealth: async () => true }
        );
        const res = await getJson(server.url, "/capabilities");
        expect(await res.json()).toEqual({
            schemaVersion: 1,
            docling: "ok",
            ocrOrder: ["DOCLING"],
            defaultProvider: "DOCLING",
        });
    });

    it("requires the API key like every non-health endpoint", async () => {
        server = await startApp(testConfig());
        const res = await getJson(server.url, "/capabilities", null);
        expect(res.status).toBe(401);
    });
});
