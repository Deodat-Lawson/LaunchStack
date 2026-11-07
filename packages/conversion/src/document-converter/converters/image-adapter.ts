/**
 * Image Adapter - Handles image files (PNG, JPG, TIFF, etc.)
 * Reads them with the shared OCR order (ocr-processing/provider-order.ts):
 * the operator pin, Azure, Docling (when the converter reports docling-serve
 * up), Landing AI, then Tesseract on this server as the last resort. A
 * provider that fails hands over to the next one instead of failing the job.
 * Datalab is left out: its adapter submits PDFs only.
 * AI parser: may call external services.
 */

import type {
    SourceAdapter,
    SourceAdapterOptions,
    StandardizedDocument,
    IngestionProvider,
} from "../../types";
import { getStoragePort } from "@launchstack/runtime";
import { availableOcrEngines, type OcrEngine } from "../../ocr-processing/provider-order";
import type { NormalizedDocument } from "../../ocr-processing/types";

type ImageProvider = Exclude<OcrEngine, "DATALAB"> | "TESSERACT";

const INGESTION_NAME: Record<ImageProvider, IngestionProvider> = {
    AZURE: "azure",
    DOCLING: "docling",
    LANDING_AI: "landing_ai",
    TESSERACT: "tesseract",
};

interface ImageOcrResult {
    pages: { pageNumber: number; textBlocks: string[]; tables: never[] }[];
    /** Provider-reported [0,1] confidence; absent when none was reported. */
    confidenceScore?: number;
}

export class ImageAdapter implements SourceAdapter {
    readonly name = "ImageAdapter";
    /** Azure, Docling and Landing AI fetch the stored file themselves. */
    readonly needsUrl = true;

    private static readonly MIME_TYPES = new Set([
        "image/png",
        "image/jpeg",
        "image/jpg",
        "image/tiff",
        "image/webp",
        "image/gif",
        "image/bmp",
    ]);

    private static readonly EXTENSIONS = new Set([
        ".png",
        ".jpg",
        ".jpeg",
        ".tiff",
        ".tif",
        ".webp",
        ".gif",
        ".bmp",
    ]);

    canHandle(mimeType: string, extension: string): boolean {
        return (
            ImageAdapter.MIME_TYPES.has(mimeType) ||
            ImageAdapter.EXTENSIONS.has(extension.toLowerCase())
        );
    }

    async process(
        input: string | Buffer,
        options?: SourceAdapterOptions
    ): Promise<StandardizedDocument> {
        const startTime = Date.now();
        console.log(
            `[ImageAdapter] Processing: file=${options?.filename ?? "unknown"}, mime=${options?.mimeType ?? "none"}`
        );

        const chain = await this.providerChain(input);
        console.log(`[ImageAdapter] Provider chain: ${chain.join(" → ")}`);

        let result: ImageOcrResult | undefined;
        let used: ImageProvider = "TESSERACT";
        const ocrStart = Date.now();
        for (const provider of chain) {
            try {
                result = await this.runProvider(provider, input);
                used = provider;
                break;
            } catch (error) {
                console.warn(
                    `[ImageAdapter] ${provider} failed, trying the next provider:`,
                    error instanceof Error ? error.message : error
                );
            }
        }
        result ??= await this.processWithTesseract(input);
        const ocrMs = Date.now() - ocrStart;

        const providerName = INGESTION_NAME[used];
        const { pages } = result;
        const textLen = pages.reduce((s, p) => s + p.textBlocks.join("").length, 0);
        const elapsed = Date.now() - startTime;
        console.log(
            `[ImageAdapter] Done: provider=${providerName}, pages=${pages.length}, ` +
                `textChars=${textLen}, ocr=${ocrMs}ms, total=${elapsed}ms`
        );

        return {
            pages,
            metadata: {
                sourceType: "image",
                totalPages: pages.length,
                provider: providerName,
                processingTimeMs: elapsed,
                // Provider-reported only; Tesseract and Docling report none.
                ...(result.confidenceScore !== undefined
                    ? { confidenceScore: result.confidenceScore }
                    : {}),
                originalFilename: options?.filename,
                mimeType: options?.mimeType,
            },
        };
    }

    /**
     * The shared order, minus Datalab (PDF-only adapter), ending at
     * Tesseract. A Buffer (no stored URL) can only go to Tesseract.
     */
    async providerChain(input: string | Buffer): Promise<ImageProvider[]> {
        if (Buffer.isBuffer(input)) return ["TESSERACT"];
        const engines = await availableOcrEngines();
        return [
            ...engines.filter(
                (engine): engine is Exclude<OcrEngine, "DATALAB"> => engine !== "DATALAB"
            ),
            "TESSERACT",
        ];
    }

    private async runProvider(
        provider: ImageProvider,
        input: string | Buffer
    ): Promise<ImageOcrResult> {
        switch (provider) {
            case "AZURE": {
                const { createAzureAdapter } = await import(
                    "../../ocr-processing/adapters/azureAdapter"
                );
                return this.fromNormalized(
                    await createAzureAdapter().uploadDocument(this.resolveUrl(input))
                );
            }
            case "DOCLING": {
                const { createDoclingAdapter } = await import(
                    "../../ocr-processing/adapters/ossAdapter"
                );
                return this.fromNormalized(
                    await createDoclingAdapter().uploadDocument(this.resolveUrl(input))
                );
            }
            case "LANDING_AI": {
                const { createLandingAIAdapter } = await import(
                    "../../ocr-processing/adapters/landingAdapter"
                );
                return this.fromNormalized(
                    await createLandingAIAdapter().uploadDocument(this.resolveUrl(input))
                );
            }
            case "TESSERACT":
                return this.processWithTesseract(input);
        }
    }

    private fromNormalized(doc: NormalizedDocument): ImageOcrResult {
        return {
            pages: doc.pages.map(p => ({
                pageNumber: p.pageNumber,
                textBlocks: p.textBlocks,
                tables: [] as never[],
            })),
            ...(doc.metadata.confidenceScore !== undefined
                ? { confidenceScore: doc.metadata.confidenceScore }
                : {}),
        };
    }

    private async processWithTesseract(input: string | Buffer): Promise<ImageOcrResult> {
        try {
            const Tesseract = await import("tesseract.js");

            let imageData: string | Buffer;
            if (Buffer.isBuffer(input)) {
                imageData = input;
            } else {
                // The storage port resolves and signs internal /api/files/
                // references; a bare fetch cannot.
                const res = await getStoragePort().download(input);
                if (!res.ok) throw new Error(`ImageAdapter fetch failed: ${res.status}`);
                const ab = await res.arrayBuffer();
                imageData = Buffer.from(ab);
            }

            const worker = await Tesseract.createWorker("eng");
            const result = await worker.recognize(imageData);
            await worker.terminate();

            const text = result.data.text.trim();

            return {
                pages: [
                    {
                        pageNumber: 1,
                        textBlocks: text.length > 0 ? [text] : ["[No text detected in image]"],
                        tables: [] as never[],
                    },
                ],
            };
        } catch (error) {
            console.warn(
                "[ImageAdapter] Tesseract failed, returning empty result:",
                error instanceof Error ? error.message : error
            );
            return {
                pages: [
                    {
                        pageNumber: 1,
                        textBlocks: [
                            "[OCR not available — install tesseract.js or configure Azure/Landing.AI]",
                        ],
                        tables: [] as never[],
                    },
                ],
            };
        }
    }

    private resolveUrl(input: string | Buffer): string {
        if (Buffer.isBuffer(input)) {
            throw new Error(
                "ImageAdapter with Azure/Docling/Landing.AI requires a URL. " +
                    "Store the file first and pass the URL."
            );
        }
        return input;
    }
}
