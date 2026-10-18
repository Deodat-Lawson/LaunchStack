/**
 * The one OCR order the app uses. services/document-converter keeps a copy
 * for /route (test/providers.test.ts pins it there); these two lists must
 * stay identical.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { configureOcr } from "./config";
import {
    OCR_PROVIDER_ORDER,
    availableOcrEngines,
    configuredOcrAvailability,
    defaultOcrProvider,
    isDoclingReachable,
    ocrFallbackChain,
    orderOcrEngines,
    resetDoclingReachability,
} from "./provider-order";

const ALL = { AZURE: true, DOCLING: true, LANDING_AI: true, DATALAB: true };
const CONVERTER = { url: "http://converter.test:8002", apiKey: "k" };

function capabilities(docling: string): Response {
    return new Response(JSON.stringify({ schemaVersion: 1, docling, ocrOrder: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
    });
}

beforeEach(() => {
    resetDoclingReachability();
    configureOcr({});
});

afterEach(() => {
    vi.unstubAllGlobals();
    configureOcr({});
});

describe("order", () => {
    it("is Azure, Docling, Landing AI, Datalab", () => {
        expect(OCR_PROVIDER_ORDER).toEqual(["AZURE", "DOCLING", "LANDING_AI", "DATALAB"]);
        expect(orderOcrEngines(ALL, undefined)).toEqual([
            "AZURE",
            "DOCLING",
            "LANDING_AI",
            "DATALAB",
        ]);
    });

    it("puts an available operator pin first and ignores one that cannot run", () => {
        expect(orderOcrEngines(ALL, "DATALAB")).toEqual([
            "DATALAB",
            "AZURE",
            "DOCLING",
            "LANDING_AI",
        ]);
        expect(orderOcrEngines({ ...ALL, DOCLING: false }, "DOCLING")).toEqual([
            "AZURE",
            "LANDING_AI",
            "DATALAB",
        ]);
    });

    it("counts Docling only when the converter is configured and says docling-serve answers", () => {
        configureOcr({ azure: { endpoint: "https://a.test", key: "k" } });
        expect(configuredOcrAvailability(undefined, true).DOCLING).toBe(false);
        configureOcr({ converter: CONVERTER });
        expect(configuredOcrAvailability(undefined, false).DOCLING).toBe(false);
        expect(configuredOcrAvailability(undefined, true).DOCLING).toBe(true);
    });

    it("defaults to the text layer only when no engine can run, or when an operator pinned it", () => {
        const none = { AZURE: false, DOCLING: false, LANDING_AI: false, DATALAB: false };
        expect(defaultOcrProvider(none)).toBe("NATIVE_PDF");
        expect(defaultOcrProvider(ALL)).toBe("AZURE");
        configureOcr({ defaultProvider: "NATIVE_PDF" });
        expect(defaultOcrProvider(ALL)).toBe("NATIVE_PDF");
        expect(defaultOcrProvider(ALL, { forceOCR: true })).toBe("AZURE");
    });
});

describe("fallback chain", () => {
    it("tries the choice, then every other engine, then the PDF's text layer", () => {
        expect(ocrFallbackChain("AZURE", ["AZURE", "DOCLING"], { isPdf: true })).toEqual([
            "AZURE",
            "DOCLING",
            "NATIVE_PDF",
        ]);
        expect(ocrFallbackChain("DOCLING", ["AZURE", "DOCLING"], { isPdf: true })).toEqual([
            "DOCLING",
            "AZURE",
            "NATIVE_PDF",
        ]);
    });

    it("still tries an explicit choice that looks unavailable — it falls back if it fails", () => {
        expect(ocrFallbackChain("LANDING_AI", ["AZURE"], { isPdf: true })).toEqual([
            "LANDING_AI",
            "AZURE",
            "NATIVE_PDF",
        ]);
    });

    it("keeps the text-only method exactly that", () => {
        expect(ocrFallbackChain("NATIVE_PDF", ["AZURE", "DOCLING"], { isPdf: true })).toEqual([
            "NATIVE_PDF",
        ]);
    });

    it("ends without the text layer for something that is not a PDF", () => {
        expect(ocrFallbackChain("AZURE", ["AZURE"], { isPdf: false })).toEqual(["AZURE"]);
    });
});

describe("Docling reachability", () => {
    it("is false with no converter, without calling anything", async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);
        await expect(isDoclingReachable()).resolves.toBe(false);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("asks the converter's /capabilities with the API key, and caches the answer", async () => {
        configureOcr({ converter: CONVERTER });
        const fetchMock = vi.fn(async () => capabilities("ok"));
        vi.stubGlobal("fetch", fetchMock);

        await expect(isDoclingReachable()).resolves.toBe(true);
        await expect(isDoclingReachable()).resolves.toBe(true);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe("http://converter.test:8002/capabilities");
        expect((init.headers as Record<string, string>)["X-API-Key"]).toBe("k");
    });

    it("reads unreachable, an error, or an older converter without /capabilities as false", async () => {
        configureOcr({ converter: CONVERTER });
        for (const answer of [
            async () => capabilities("unreachable"),
            async () => capabilities("not-configured"),
            async () => new Response("no route", { status: 404 }),
            async () => {
                throw new Error("ECONNREFUSED");
            },
        ]) {
            resetDoclingReachability();
            vi.stubGlobal("fetch", vi.fn(answer));
            await expect(isDoclingReachable()).resolves.toBe(false);
        }
    });

    it("drops Docling from the engines that can run while docling-serve is down", async () => {
        configureOcr({
            converter: CONVERTER,
            azure: { endpoint: "https://a.test", key: "k" },
            defaultProvider: "DOCLING",
        });
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => capabilities("unreachable"))
        );
        await expect(availableOcrEngines()).resolves.toEqual(["AZURE"]);

        resetDoclingReachability();
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => capabilities("ok"))
        );
        await expect(availableOcrEngines()).resolves.toEqual(["DOCLING", "AZURE"]);
    });
});
