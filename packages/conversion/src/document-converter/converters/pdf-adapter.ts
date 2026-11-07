import type { OCRProvider } from "../../ocr-processing/types";
import type {
    IngestionProvider,
    SourceAdapter,
    SourceAdapterOptions,
    StandardizedDocument,
} from "../../types";

/** The OCR provider that produced the text, as the ingestion layer names it. */
export function ingestionProviderFor(provider: OCRProvider): IngestionProvider {
    switch (provider) {
        case "AZURE":
            return "azure";
        case "DOCLING":
            return "docling";
        case "LANDING_AI":
            return "landing_ai";
        case "DATALAB":
            return "datalab";
        default:
            return "native_pdf";
    }
}

export class PdfAdapter implements SourceAdapter {
    readonly name = "PdfAdapter";

    private static readonly MIME_TYPES = new Set(["application/pdf"]);
    private static readonly EXTENSIONS = new Set([".pdf"]);

    canHandle(mimeType: string, extension: string): boolean {
        return (
            PdfAdapter.MIME_TYPES.has(mimeType) ||
            PdfAdapter.EXTENSIONS.has(extension.toLowerCase())
        );
    }

    async process(
        input: string | Buffer,
        options?: SourceAdapterOptions
    ): Promise<StandardizedDocument> {
        const startTime = Date.now();
        console.log(
            `[PdfAdapter] Processing: file=${options?.filename ?? "unknown"}, forceOCR=${options?.forceOCR ?? false}`
        );

        const documentUrl = this.resolveUrl(input);
        console.log(
            `[PdfAdapter] Delegating to existing OCR pipeline: url=${documentUrl.substring(0, 100)}`
        );

        const { routeDocument, normalizeDocument } = await import("../../ocr-processing/processor");

        const routeStart = Date.now();
        const routing = await routeDocument(documentUrl, {
            forceOCR: options?.forceOCR,
            mimeType: options?.mimeType,
            filename: options?.filename,
        });
        console.log(
            `[PdfAdapter] Routing decision (${Date.now() - routeStart}ms): ` +
                `isNative=${routing.isNativePDF}, provider=${routing.selectedProvider}, pages=${routing.pageCount}`
        );

        const normStart = Date.now();
        const normResult = await normalizeDocument(documentUrl, routing);
        console.log(
            `[PdfAdapter] Normalization done (${Date.now() - normStart}ms): ` +
                `pages=${normResult.pages.length}, confidence=${normResult.confidenceScore ?? "N/A"}`
        );

        const elapsed = Date.now() - startTime;
        // The provider that produced the text — after any fallback — not
        // the one routing asked for.
        const provider = ingestionProviderFor(normResult.provider);
        console.log(
            `[PdfAdapter] Done: ${normResult.pages.length} pages, provider=${provider} (${elapsed}ms)`
        );

        return {
            pages: normResult.pages.map(p => ({
                pageNumber: p.pageNumber,
                textBlocks: p.textBlocks,
                tables: p.tables,
            })),
            metadata: {
                sourceType: "pdf",
                totalPages: normResult.pages.length,
                provider,
                processingTimeMs: elapsed,
                confidenceScore: normResult.confidenceScore,
                originalFilename: options?.filename,
                mimeType: options?.mimeType,
            },
        };
    }

    private resolveUrl(input: string | Buffer): string {
        if (Buffer.isBuffer(input)) {
            throw new Error(
                "PdfAdapter requires a URL, not a Buffer. " +
                    "Store the file first and pass the URL to the ingestion router."
            );
        }
        return input;
    }
}
