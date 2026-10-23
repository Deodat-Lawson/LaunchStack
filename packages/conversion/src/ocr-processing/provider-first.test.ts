import { configureStorage } from "@launchstack/runtime";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { configureOcr } from "./config";
import { normalizeDocument, routeDocument, type RouterDecisionResult } from "./processor";

/**
 * OCR_PDF_STRATEGY=provider-first: every PDF goes to the OCR provider, even
 * one with a perfectly good text layer, and that text layer is read only
 * when the provider fails. A scan has no text layer to fall back on, so its
 * provider error must stand (and the outbox retries the provider). Neither
 * may a mixed PDF's scanned pages be indexed empty while the provider could
 * still read them.
 */

const BOOK_URL = "https://files.test/book.pdf";
const AZURE = { endpoint: "https://azure.test", key: "test-key" };

const providerFirstDecision: RouterDecisionResult = {
    isNativePDF: false,
    pageCount: 2,
    selectedProvider: "AZURE",
    reason: "provider-first",
    nativeFallback: true,
};

/** A 1×1 PNG: enough to make a page "scanned" (an image, no text). */
const PIXEL_PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
);
const SCANNED = { scanned: true } as const;

/** One entry per page: its text, "" for a blank page, or SCANNED. */
async function makePdf(pageSpecs: Array<string | typeof SCANNED>): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const pixel = await doc.embedPng(PIXEL_PNG);
    for (const spec of pageSpecs) {
        const page = doc.addPage();
        if (typeof spec !== "string") {
            page.drawImage(pixel, { x: 0, y: 0, width: 600, height: 800 });
        } else if (spec) {
            page.drawText(spec, { x: 50, y: 700, size: 12, font });
        }
    }
    return doc.save();
}

function serve(pdf: Uint8Array): void {
    configureStorage({
        provider: "test",
        upload: vi.fn(),
        delete: vi.fn(),
        download: vi.fn(
            async () =>
                new Response(Buffer.from(pdf), { headers: { "content-type": "application/pdf" } })
        ),
    });
}

/** Every Azure call answers with this status, as a submit that Azure refuses outright. */
function azureRefuses(status = 400) {
    const fetchMock = vi.fn(
        async () =>
            new Response('{"error":{"code":"InvalidRequest","message":"refused"}}', { status })
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
}

/** Azure cannot be reached: a failure a later attempt may not repeat. */
function azureUnreachable() {
    vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
            throw new TypeError("fetch failed");
        })
    );
}

beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("routeDocument", () => {
    it("sends a PDF with a text layer straight to Azure under provider-first", async () => {
        configureOcr({
            defaultProvider: "AZURE",
            pdfStrategy: "provider-first",
            azure: AZURE,
            converter: { url: "http://converter.test", apiKey: "k" },
        });
        serve(await makePdf(["Chapter one", "Chapter two"]));
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);

        const decision = await routeDocument(BOOK_URL);

        expect(decision).toMatchObject({
            isNativePDF: false,
            selectedProvider: "AZURE",
            reason: "provider-first",
            nativeFallback: true,
            pageCount: 2,
        });
        // The converter's text-layer check is exactly what this skips.
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("reads the text layer first when Azure has no credentials", async () => {
        configureOcr({ defaultProvider: "AZURE", pdfStrategy: "provider-first" });
        serve(await makePdf(["Chapter one"]));

        const decision = await routeDocument(BOOK_URL);

        expect(decision.reason).not.toBe("provider-first");
        expect(decision.nativeFallback).toBeUndefined();
    });

    it("leaves routing alone when no strategy is set", async () => {
        configureOcr({ defaultProvider: "AZURE", azure: AZURE });
        serve(await makePdf(["Chapter one"]));

        const decision = await routeDocument(BOOK_URL);

        expect(decision.reason).not.toBe("provider-first");
        expect(decision.nativeFallback).toBeUndefined();
    });

    it("keeps the text-layer fallback for a pinned provider, as every new version has", async () => {
        configureOcr({ defaultProvider: "AZURE", pdfStrategy: "provider-first", azure: AZURE });
        serve(await makePdf(["Chapter one"]));

        const decision = await routeDocument(BOOK_URL, { preferredProvider: "AZURE" });

        expect(decision).toMatchObject({
            selectedProvider: "AZURE",
            reason: "preferred-provider",
            nativeFallback: true,
        });
    });

    it("gives a pinned provider no fallback when no strategy is set", async () => {
        configureOcr({ defaultProvider: "AZURE", azure: AZURE });
        serve(await makePdf(["Chapter one"]));

        const decision = await routeDocument(BOOK_URL, { preferredProvider: "AZURE" });

        expect(decision.nativeFallback).toBeUndefined();
    });
});

describe("normalizeDocument", () => {
    beforeEach(() => {
        configureOcr({ defaultProvider: "AZURE", pdfStrategy: "provider-first", azure: AZURE });
    });

    it("uses Azure's pages when Azure succeeds", async () => {
        vi.useFakeTimers();
        serve(await makePdf(["Chapter one"]));
        vi.stubGlobal(
            "fetch",
            vi.fn(async (_url: string, init?: RequestInit) =>
                init?.method === "POST"
                    ? new Response(null, {
                          status: 202,
                          headers: { "Operation-Location": "https://azure.test/op/1" },
                      })
                    : Response.json({
                          status: "succeeded",
                          analyzeResult: {
                              pages: [{ pageNumber: 1, spans: [] }],
                              paragraphs: [
                                  {
                                      content: "Chapter one, as Azure read it",
                                      boundingRegions: [{ pageNumber: 1, boundingBox: [] }],
                                      spans: [],
                                  },
                              ],
                          },
                      })
            )
        );

        const pending = normalizeDocument(BOOK_URL, providerFirstDecision);
        await vi.advanceTimersByTimeAsync(2000);
        const result = await pending;

        expect(result.provider).toBe("AZURE");
        expect(result.pages[0]?.textBlocks).toEqual(["Chapter one, as Azure read it"]);
    });

    it("reads the PDF's own text when Azure fails", async () => {
        serve(await makePdf(["Chapter one", "Chapter two"]));
        azureRefuses();

        const result = await normalizeDocument(BOOK_URL, providerFirstDecision);

        expect(result.provider).toBe("NATIVE_PDF");
        expect(result.pages.map(page => page.textBlocks.join(" "))).toEqual([
            "Chapter one",
            "Chapter two",
        ]);
    });

    it("keeps Azure's error for a scan, which has no text to fall back on", async () => {
        serve(await makePdf([SCANNED, SCANNED]));
        azureRefuses();

        await expect(normalizeDocument(BOOK_URL, providerFirstDecision)).rejects.toThrow(
            /Azure Document Intelligence submit failed: 400/
        );
    });

    it("retries Azure rather than index a mixed PDF's scanned pages empty", async () => {
        serve(await makePdf(["Chapter one", SCANNED]));
        azureUnreachable();

        await expect(normalizeDocument(BOOK_URL, providerFirstDecision)).rejects.toThrow(
            "fetch failed"
        );
    });

    it("indexes a mixed PDF's text layer once Azure refuses the file outright", async () => {
        serve(await makePdf(["Chapter one", SCANNED]));
        azureRefuses(400);

        const result = await normalizeDocument(BOOK_URL, providerFirstDecision);

        expect(result.provider).toBe("NATIVE_PDF");
        expect(result.pages.map(page => page.textBlocks)).toEqual([["Chapter one"], []]);
    });

    it("falls back through blank pages, which have nothing to read", async () => {
        serve(await makePdf(["Chapter one", "", "Chapter two"]));
        azureUnreachable();

        const result = await normalizeDocument(BOOK_URL, providerFirstDecision);

        expect(result.provider).toBe("NATIVE_PDF");
        expect(result.pages.map(page => page.textBlocks.join(" "))).toEqual([
            "Chapter one",
            "",
            "Chapter two",
        ]);
    });

    it("does not fall back when routing did not ask for it", async () => {
        serve(await makePdf(["Chapter one"]));
        azureRefuses();

        await expect(
            normalizeDocument(BOOK_URL, { ...providerFirstDecision, nativeFallback: undefined })
        ).rejects.toThrow(/Azure Document Intelligence submit failed: 400/);
    });
});
