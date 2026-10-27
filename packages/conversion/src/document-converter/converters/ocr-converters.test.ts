/**
 * The image and PDF converters name the provider that actually read the
 * file. The image converter used to swap Azure and Landing AI, and the PDF
 * converter called every OCR result "azure".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NormalizedDocument, OCRProvider } from "../../ocr-processing/types";

const azure = vi.fn<(url: string) => Promise<NormalizedDocument>>();
const docling = vi.fn<(url: string) => Promise<NormalizedDocument>>();
const landing = vi.fn<(url: string) => Promise<NormalizedDocument>>();
const engines = vi.fn<() => Promise<string[]>>();

vi.mock("../../ocr-processing/adapters/azureAdapter", () => ({
    createAzureAdapter: () => ({ uploadDocument: (url: string) => azure(url) }),
}));
vi.mock("../../ocr-processing/adapters/ossAdapter", () => ({
    createDoclingAdapter: () => ({ uploadDocument: (url: string) => docling(url) }),
}));
vi.mock("../../ocr-processing/adapters/landingAdapter", () => ({
    createLandingAIAdapter: () => ({ uploadDocument: (url: string) => landing(url) }),
}));
vi.mock("../../ocr-processing/provider-order", async importOriginal => ({
    ...(await importOriginal<object>()),
    availableOcrEngines: () => engines(),
}));

const routeDocument = vi.fn();
const normalizeDocument = vi.fn();
vi.mock("../../ocr-processing/processor", () => ({
    routeDocument: (...args: unknown[]) => routeDocument(...args),
    normalizeDocument: (...args: unknown[]) => normalizeDocument(...args),
}));

import { ImageAdapter } from "./image-adapter";
import { PdfAdapter, ingestionProviderFor } from "./pdf-adapter";

function read(provider: OCRProvider, confidenceScore?: number): NormalizedDocument {
    return {
        pages: [{ pageNumber: 1, textBlocks: [`read by ${provider}`], tables: [] }],
        metadata: {
            totalPages: 1,
            provider,
            processingTimeMs: 1,
            ...(confidenceScore !== undefined ? { confidenceScore } : {}),
        },
    };
}

beforeEach(() => {
    for (const fn of [azure, docling, landing, engines, routeDocument, normalizeDocument]) {
        fn.mockReset();
    }
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => vi.restoreAllMocks());

describe("ImageAdapter", () => {
    const image = "/api/files/7";

    it("asks for the stored URL, so Azure can fetch the file itself", () => {
        expect(new ImageAdapter().needsUrl).toBe(true);
    });

    it("labels an Azure read azure (it used to say landing_ai)", async () => {
        engines.mockResolvedValue(["AZURE", "LANDING_AI"]);
        azure.mockResolvedValue(read("AZURE", 0.97));

        const doc = await new ImageAdapter().process(image, { mimeType: "image/png" });

        expect(doc.metadata.provider).toBe("azure");
        expect(doc.metadata.confidenceScore).toBe(0.97);
        expect(landing).not.toHaveBeenCalled();
    });

    it("labels a Landing AI read landing_ai (it used to say azure)", async () => {
        engines.mockResolvedValue(["LANDING_AI"]);
        landing.mockResolvedValue(read("LANDING_AI"));

        const doc = await new ImageAdapter().process(image, { mimeType: "image/png" });

        expect(doc.metadata.provider).toBe("landing_ai");
        // No fabricated 85 when the provider reported nothing.
        expect(doc.metadata.confidenceScore).toBeUndefined();
    });

    it("uses the shared order — Azure first — and falls to Docling when Azure fails", async () => {
        engines.mockResolvedValue(["AZURE", "DOCLING", "LANDING_AI"]);
        azure.mockRejectedValue(new Error("401 invalid subscription key"));
        docling.mockResolvedValue(read("DOCLING"));

        const doc = await new ImageAdapter().process(image, { mimeType: "image/png" });

        expect(azure).toHaveBeenCalledWith(image);
        expect(doc.metadata.provider).toBe("docling");
        expect(doc.pages[0]?.textBlocks).toEqual(["read by DOCLING"]);
        expect(landing).not.toHaveBeenCalled();
    });

    it("leaves Datalab out (its adapter submits PDFs only) and ends at Tesseract", async () => {
        engines.mockResolvedValue(["AZURE", "DATALAB"]);
        await expect(new ImageAdapter().providerChain(image)).resolves.toEqual([
            "AZURE",
            "TESSERACT",
        ]);
        await expect(new ImageAdapter().providerChain(Buffer.from("png"))).resolves.toEqual([
            "TESSERACT",
        ]);
    });
});

describe("PdfAdapter", () => {
    it.each([
        ["AZURE", "azure"],
        ["DOCLING", "docling"],
        ["LANDING_AI", "landing_ai"],
        ["DATALAB", "datalab"],
        ["NATIVE_PDF", "native_pdf"],
    ] as const)("names %s as %s", (provider, label) => {
        expect(ingestionProviderFor(provider)).toBe(label);
    });

    it("reports the provider that produced the text after a fallback, not the one routed to", async () => {
        routeDocument.mockResolvedValue({
            isNativePDF: false,
            pageCount: 1,
            selectedProvider: "AZURE",
            reason: "vision-complex",
        });
        normalizeDocument.mockResolvedValue({
            pages: read("DOCLING").pages,
            provider: "DOCLING",
            processingTimeMs: 1,
        });

        const doc = await new PdfAdapter().process("https://files.test/a.pdf", {
            filename: "a.pdf",
            mimeType: "application/pdf",
            forceOCR: true,
        });

        expect(doc.metadata.provider).toBe("docling");
        expect(routeDocument).toHaveBeenCalledWith("https://files.test/a.pdf", {
            forceOCR: true,
            mimeType: "application/pdf",
            filename: "a.pdf",
        });
    });
});
