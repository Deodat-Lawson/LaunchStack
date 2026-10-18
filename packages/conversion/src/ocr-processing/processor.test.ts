/**
 * Routing and normalization fall back instead of failing: the provider
 * routing chose is tried first, then every other engine that can run, then
 * the PDF's own text layer — and the result says which one produced the
 * text and why the others did not.
 *
 * The OCR adapters are stubbed; the text layer is the real pdfjs path over a
 * real PDF, so "falls back to native" means actual extracted text.
 */
import { PDFDocument, StandardFonts } from "pdf-lib";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { configureStorage } from "@launchstack/runtime";

import type { NormalizedDocument } from "./types";

const azure = vi.fn<(url: string) => Promise<NormalizedDocument>>();
const docling = vi.fn<(url: string) => Promise<NormalizedDocument>>();
const landing = vi.fn<(url: string) => Promise<NormalizedDocument>>();

vi.mock("./adapters/azureAdapter", () => ({
    createAzureAdapter: () => ({ uploadDocument: (url: string) => azure(url) }),
}));
vi.mock("./adapters/ossAdapter", () => ({
    createDoclingAdapter: () => ({ uploadDocument: (url: string) => docling(url) }),
}));
vi.mock("./adapters/landingAdapter", () => ({
    createLandingAIAdapter: () => ({ uploadDocument: (url: string) => landing(url) }),
}));

import { configureOcr } from "./config";
import { normalizeDocument, routeDocument, type RouterDecisionResult } from "./processor";
import { resetDoclingReachability } from "./provider-order";

const DOC_URL = "https://files.test/report.pdf";
const CONVERTER = { url: "http://converter.test:8002", apiKey: "k" };
const AZURE_CFG = { endpoint: "https://azure.test", key: "azure-key" };

let pdfBytes: Uint8Array;

beforeAll(async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (const n of [1, 2, 3]) {
        doc.addPage([400, 300]).drawText(`Text layer page ${n}: revenue grew in every region`, {
            x: 40,
            y: 200,
            size: 12,
            font,
        });
    }
    pdfBytes = await doc.save();
});

function ocrResult(provider: "AZURE" | "DOCLING" | "LANDING_AI", pages = 3): NormalizedDocument {
    return {
        pages: Array.from({ length: pages }, (_, i) => ({
            pageNumber: i + 1,
            textBlocks: [`${provider} read page ${i + 1} of the scan`],
            tables: [],
        })),
        metadata: { totalPages: pages, provider, processingTimeMs: 5 },
    };
}

function decision(provider: RouterDecisionResult["selectedProvider"]): RouterDecisionResult {
    return {
        isNativePDF: provider === "NATIVE_PDF",
        pageCount: 3,
        selectedProvider: provider,
        reason: "vision-complex",
    };
}

/** Answers the converter's /capabilities (Docling up or down) and /route. */
function stubConverter(options: {
    docling: "ok" | "unreachable";
    route?: Record<string, unknown>;
}): void {
    vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
            if (url.endsWith("/capabilities")) {
                return Response.json({ schemaVersion: 1, docling: options.docling, ocrOrder: [] });
            }
            if (url.endsWith("/route") && options.route) {
                return Response.json({ schemaVersion: 1, signals: {}, ...options.route });
            }
            throw new Error(`unexpected fetch ${url}`);
        })
    );
}

beforeEach(() => {
    resetDoclingReachability();
    azure.mockReset();
    docling.mockReset();
    landing.mockReset();
    configureStorage({
        provider: "test",
        upload: vi.fn(),
        delete: vi.fn(),
        download: vi.fn(async () => new Response(new Uint8Array(pdfBytes), { status: 200 })),
    });
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    configureOcr({});
});

describe("normalizeDocument", () => {
    it("records Azure as the provider when Azure reads the document", async () => {
        configureOcr({ azure: AZURE_CFG, converter: CONVERTER });
        stubConverter({ docling: "ok" });
        azure.mockResolvedValue(ocrResult("AZURE"));

        const result = await normalizeDocument(DOC_URL, decision("AZURE"));

        expect(result.provider).toBe("AZURE");
        expect(result.pages).toHaveLength(3);
        expect(result.ocrRouting).toMatchObject({
            requestedProvider: "AZURE",
            provider: "AZURE",
            fellBack: false,
            attempts: [{ provider: "AZURE", ok: true }],
        });
        expect(docling).not.toHaveBeenCalled();
    });

    it("falls back to Docling when Azure throws, and says why", async () => {
        configureOcr({ azure: AZURE_CFG, converter: CONVERTER });
        stubConverter({ docling: "ok" });
        azure.mockRejectedValue(
            new Error(
                "Azure Document Intelligence submit failed: 401 - Access denied due to invalid subscription key"
            )
        );
        docling.mockResolvedValue(ocrResult("DOCLING"));

        const result = await normalizeDocument(DOC_URL, decision("AZURE"));

        expect(result.provider).toBe("DOCLING");
        expect(result.pages[0]?.textBlocks[0]).toContain("DOCLING read page 1");
        expect(result.ocrRouting?.fellBack).toBe(true);
        expect(result.ocrRouting?.requestedProvider).toBe("AZURE");
        expect(result.ocrRouting?.attempts.map(a => [a.provider, a.ok])).toEqual([
            ["AZURE", false],
            ["DOCLING", true],
        ]);
        expect(result.ocrRouting?.attempts[0]?.error).toMatch(/401/);
    });

    it("skips a Docling the converter reports down and ends on the PDF's text layer", async () => {
        configureOcr({ azure: AZURE_CFG, converter: CONVERTER });
        stubConverter({ docling: "unreachable" });
        azure.mockRejectedValue(new Error("Azure Document Intelligence analysis timed out"));

        const result = await normalizeDocument(DOC_URL, decision("AZURE"));

        expect(docling).not.toHaveBeenCalled();
        expect(result.provider).toBe("NATIVE_PDF");
        expect(result.pages.map(p => p.textBlocks.join(" "))).toEqual([
            "Text layer page 1: revenue grew in every region",
            "Text layer page 2: revenue grew in every region",
            "Text layer page 3: revenue grew in every region",
        ]);
        expect(result.ocrRouting?.attempts.map(a => a.provider)).toEqual(["AZURE", "NATIVE_PDF"]);
    });

    it("an explicitly chosen provider still falls back, on the record", async () => {
        configureOcr({ azure: AZURE_CFG, converter: CONVERTER });
        stubConverter({ docling: "ok" });
        docling.mockRejectedValue(
            new Error(
                "Document converter /convert failed: 503 Service Unavailable — docling-not-configured"
            )
        );
        azure.mockResolvedValue(ocrResult("AZURE"));

        const result = await normalizeDocument(DOC_URL, {
            ...decision("DOCLING"),
            reason: "preferred-provider",
        });

        expect(result.provider).toBe("AZURE");
        expect(result.ocrRouting).toMatchObject({
            requestedProvider: "DOCLING",
            provider: "AZURE",
            fellBack: true,
            routingReason: "preferred-provider",
        });
        expect(result.ocrRouting?.attempts[0]).toMatchObject({ provider: "DOCLING", ok: false });
        expect(result.ocrRouting?.attempts[0]?.error).toMatch(/503/);
    });

    it("keeps the text-only method on the text layer — no OCR is tried", async () => {
        configureOcr({ azure: AZURE_CFG, converter: CONVERTER });
        stubConverter({ docling: "ok" });

        const result = await normalizeDocument(DOC_URL, decision("NATIVE_PDF"));

        expect(azure).not.toHaveBeenCalled();
        expect(docling).not.toHaveBeenCalled();
        expect(result.provider).toBe("NATIVE_PDF");
        expect(result.ocrRouting?.fellBack).toBe(false);
    });

    it("treats Azure returning fewer pages than the PDF as partial (the F0 two-page trap)", async () => {
        configureOcr({ azure: AZURE_CFG });
        const partial = ocrResult("AZURE", 2);
        // A scan's pages read in full: far more text than the text layer's
        // one line a page.
        partial.pages.forEach(page =>
            page.textBlocks.push("A full paragraph of scanned text. ".repeat(6))
        );
        azure.mockResolvedValue(partial);

        const result = await normalizeDocument(DOC_URL, decision("AZURE"));

        // The real text layer holds all three pages but less text than
        // Azure's two, so Azure's partial read is kept — and flagged.
        expect(result.provider).toBe("AZURE");
        expect(result.pages).toHaveLength(2);
        expect(result.ocrRouting?.attempts[0]?.error).toMatch(/2 of 3 pages/);
    });

    it("strips query strings (signed tokens) from recorded errors", async () => {
        configureOcr({ azure: AZURE_CFG });
        azure.mockRejectedValue(
            new Error(
                "Failed to fetch document from https://app.test/api/files/9?token=SECRET: 401"
            )
        );

        const result = await normalizeDocument(DOC_URL, decision("AZURE"));

        expect(result.provider).toBe("NATIVE_PDF");
        expect(result.ocrRouting?.attempts[0]?.error).not.toContain("SECRET");
        expect(result.ocrRouting?.attempts[0]?.error).toContain("https://app.test/api/files/9?…");
    });

    it("fails only when every provider, the text layer included, fails", async () => {
        configureOcr({ azure: AZURE_CFG });
        azure.mockRejectedValue(new Error("Azure down"));
        configureStorage({
            provider: "test",
            upload: vi.fn(),
            delete: vi.fn(),
            download: vi.fn(async () => new Response("gone", { status: 404 })),
        });

        await expect(normalizeDocument(DOC_URL, decision("AZURE"))).rejects.toThrow(
            /Every OCR provider failed \(AZURE: Azure down; NATIVE_PDF: Fetch failed: 404\)/
        );
    });

    describe("a scan with no text layer", () => {
        let blankPdf: Uint8Array;

        beforeAll(async () => {
            const doc = await PDFDocument.create();
            for (let n = 0; n < 3; n++) doc.addPage([400, 300]);
            blankPdf = await doc.save();
        });

        beforeEach(() => {
            configureStorage({
                provider: "test",
                upload: vi.fn(),
                delete: vi.fn(),
                download: vi.fn(
                    async () => new Response(new Uint8Array(blankPdf), { status: 200 })
                ),
            });
        });

        it("fails the job when every OCR engine fails, rather than index a blank document", async () => {
            configureOcr({ azure: AZURE_CFG, converter: CONVERTER });
            stubConverter({ docling: "unreachable" });
            azure.mockRejectedValue(new Error("Azure Document Intelligence error 401"));

            await expect(normalizeDocument(DOC_URL, decision("AZURE"))).rejects.toThrow(
                /OCR failed and the PDF has no text layer to fall back on.*AZURE: Azure Document Intelligence error 401/
            );
        });

        it("does not take page numbers alone for a text layer", async () => {
            const doc = await PDFDocument.create();
            const font = await doc.embedFont(StandardFonts.Helvetica);
            for (let n = 1; n <= 12; n++) {
                doc.addPage([400, 300]).drawText(`Page ${n} of 12`, {
                    x: 40,
                    y: 20,
                    size: 9,
                    font,
                });
            }
            const stamped = await doc.save();
            configureStorage({
                provider: "test",
                upload: vi.fn(),
                delete: vi.fn(),
                download: vi.fn(async () => new Response(new Uint8Array(stamped), { status: 200 })),
            });
            configureOcr({ azure: AZURE_CFG, converter: CONVERTER });
            stubConverter({ docling: "unreachable" });
            azure.mockRejectedValue(new Error("Azure down"));

            await expect(normalizeDocument(DOC_URL, decision("AZURE"))).rejects.toThrow(
                /no text layer to fall back on/
            );
        });

        it("still finishes when OCR reads it after an earlier engine failed", async () => {
            configureOcr({ azure: AZURE_CFG, converter: CONVERTER });
            stubConverter({ docling: "ok" });
            azure.mockRejectedValue(new Error("Azure down"));
            docling.mockResolvedValue(ocrResult("DOCLING"));

            const result = await normalizeDocument(DOC_URL, decision("AZURE"));

            expect(result.provider).toBe("DOCLING");
            expect(result.ocrRouting?.fellBack).toBe(true);
        });

        it("keeps a chosen text-only method blank instead of failing", async () => {
            configureOcr({ azure: AZURE_CFG, converter: CONVERTER });
            stubConverter({ docling: "ok" });

            const result = await normalizeDocument(DOC_URL, decision("NATIVE_PDF"));

            expect(azure).not.toHaveBeenCalled();
            expect(result.provider).toBe("NATIVE_PDF");
        });
    });
});

describe("routeDocument", () => {
    it("passes forceOCR, mime type and filename through to the converter", async () => {
        configureOcr({ converter: CONVERTER, azure: AZURE_CFG });
        stubConverter({ docling: "ok", route: { provider: "AZURE", reason: "force-ocr" } });

        const result = await routeDocument(DOC_URL, {
            forceOCR: true,
            mimeType: "application/pdf",
            filename: "report.pdf",
        });

        expect(result.selectedProvider).toBe("AZURE");
        const routeCall = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.find(([url]) =>
            String(url).endsWith("/route")
        ) as [string, RequestInit];
        expect(JSON.parse(routeCall[1].body as string)).toMatchObject({
            forceOCR: true,
            mimeType: "application/pdf",
            filename: "report.pdf",
        });
    });

    it("reads with an engine configured here when the converter answers NATIVE_PDF", async () => {
        // The converter's own environment lacked the Azure key; this process
        // is the one that calls Azure, so its view decides.
        configureOcr({ converter: CONVERTER, azure: AZURE_CFG });
        stubConverter({
            docling: "unreachable",
            route: { provider: "NATIVE_PDF", reason: "native-text-layer", pageCount: 3 },
        });

        const result = await routeDocument(DOC_URL);

        expect(result.isNativePDF).toBe(false);
        expect(result.selectedProvider).toBe("AZURE");
        expect(result.pageCount).toBe(3);
        expect(result.reason).toMatch(/native-text-layer/);
    });

    it("honours an operator NATIVE_PDF pin for unforced documents", async () => {
        configureOcr({ converter: CONVERTER, azure: AZURE_CFG, defaultProvider: "NATIVE_PDF" });
        stubConverter({
            docling: "unreachable",
            route: { provider: "NATIVE_PDF", reason: "native-text-layer" },
        });

        const result = await routeDocument(DOC_URL);

        expect(result.isNativePDF).toBe(true);
    });

    it("falls back to the shared order locally when the converter is unreachable", async () => {
        configureOcr({ converter: CONVERTER, azure: AZURE_CFG });
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => {
                throw new Error("connect ECONNREFUSED");
            })
        );

        const result = await routeDocument(DOC_URL);

        // Docling goes through the converter, so it is out; Azure is next.
        expect(result.selectedProvider).toBe("AZURE");
        expect(result.reason).toBe("vision-unavailable");
    });
});
