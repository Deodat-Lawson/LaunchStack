/**
 * Docling Ingestion Adapter
 *
 * Routes Office / broad-format documents (DOCX, PPTX, XLSX, EPUB)
 * through services/document-converter's /convert endpoint (Docling).
 *
 * This adapter is only enabled when the converter is configured
 * (DOCUMENT_CONVERTER_URL → ocr.converter), and it is registered *before*
 * the built-in mammoth/sheetjs adapters in `./index.ts` so it preempts them.
 * A converter without Docling behind it — the lean deployment runs none — or
 * one that cannot reach Docling, or that does not answer at all, hands the
 * file to the built-in adapter for its format instead of failing it.
 */

import { getStoragePort } from "@launchstack/runtime";

import type {
    SourceAdapter,
    SourceAdapterOptions,
    StandardizedDocument,
    StandardizedPage,
} from "../../types";
import {
    createDoclingAdapter,
    DocumentConverterError,
} from "../../ocr-processing/adapters/ossAdapter";
import { getOcrConfig } from "../../ocr-processing/config";
import { DocxAdapter } from "./docx-adapter";
import { PptxAdapter } from "./pptx-adapter";
import { SpreadsheetAdapter } from "./spreadsheet-adapter";

/** Converter error codes that mean "no Docling here", not "this file is bad". */
const DOCLING_UNAVAILABLE_CODES = new Set([
    "docling-not-configured",
    "docling-failed",
    "converter-unreachable",
]);

const BUILT_IN_ADAPTERS: SourceAdapter[] = [
    new DocxAdapter(),
    new PptxAdapter(),
    new SpreadsheetAdapter(),
];

const OFFICE_MIMES = new Set([
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
    "application/epub+zip",
]);

const OFFICE_EXTS = new Set([".docx", ".doc", ".pptx", ".ppt", ".xlsx", ".xls", ".epub"]);

export class DoclingIngestionAdapter implements SourceAdapter {
    readonly name = "DoclingIngestionAdapter";
    readonly needsUrl = true;

    canHandle(mimeType: string, extension: string): boolean {
        if (!getOcrConfig().converter?.url) return false;
        return OFFICE_MIMES.has(mimeType) || OFFICE_EXTS.has(extension.toLowerCase());
    }

    async process(
        input: string | Buffer,
        options?: SourceAdapterOptions
    ): Promise<StandardizedDocument> {
        const startTime = Date.now();
        const filename = options?.filename ?? "document";
        console.log(
            `[DoclingIngestionAdapter] Processing: file=${filename}, mime=${options?.mimeType ?? "none"}`
        );

        if (Buffer.isBuffer(input)) {
            throw new Error(
                "[DoclingIngestionAdapter] Buffer input not supported — worker needs a fetchable URL. " +
                    "Ensure the ingestion router passes a URL, or the worker must be granted direct access."
            );
        }

        const adapter = createDoclingAdapter();
        let normalized: Awaited<ReturnType<typeof adapter.uploadDocument>>;
        try {
            normalized = await adapter.uploadDocument(input);
        } catch (error) {
            const fallback = this.builtInFallback(error, options);
            if (!fallback) throw error;
            console.warn(
                `[DoclingIngestionAdapter] Docling unavailable (${(error as DocumentConverterError).code}); converting ${filename} with ${fallback.name}`
            );
            const response = await getStoragePort().download(input);
            if (!response.ok) {
                throw new Error(
                    `[DoclingIngestionAdapter] Failed to fetch ${filename} for ${fallback.name}: ${response.status} ${response.statusText}`
                );
            }
            return fallback.process(Buffer.from(await response.arrayBuffer()), options);
        }

        const pages: StandardizedPage[] = normalized.pages.map(p => ({
            pageNumber: p.pageNumber,
            textBlocks: p.textBlocks,
            tables: p.tables,
        }));

        return {
            pages,
            metadata: {
                sourceType: this.inferSourceType(options?.mimeType, options?.filename),
                totalPages: pages.length,
                provider: "docling",
                processingTimeMs: Date.now() - startTime,
                confidenceScore: normalized.metadata.confidenceScore,
                originalFilename: options?.filename,
                mimeType: options?.mimeType,
            },
        };
    }

    /**
     * The built-in adapter to use when Docling is unavailable, or undefined
     * when the error is about the file itself (or no built-in adapter reads
     * this format, as with EPUB) and should stand.
     */
    private builtInFallback(
        error: unknown,
        options?: SourceAdapterOptions
    ): SourceAdapter | undefined {
        if (!(error instanceof DocumentConverterError)) return undefined;
        if (!DOCLING_UNAVAILABLE_CODES.has(error.code)) return undefined;
        const mimeType = options?.mimeType ?? "";
        const filename = options?.filename ?? "";
        const extension = filename.includes(".")
            ? filename.slice(filename.lastIndexOf(".")).toLowerCase()
            : "";
        return BUILT_IN_ADAPTERS.find(adapter => adapter.canHandle(mimeType, extension));
    }

    private inferSourceType(
        mime?: string,
        filename?: string
    ): StandardizedDocument["metadata"]["sourceType"] {
        const ext = filename?.includes(".")
            ? filename.slice(filename.lastIndexOf(".")).toLowerCase()
            : "";
        if (ext === ".docx" || ext === ".doc" || mime?.includes("wordprocessingml")) return "docx";
        if (ext === ".pptx" || ext === ".ppt" || mime?.includes("presentationml")) return "pptx";
        if (ext === ".xlsx" || ext === ".xls" || mime?.includes("spreadsheetml")) return "xlsx";
        if (ext === ".html" || ext === ".htm" || mime?.includes("html")) return "html";
        return "docx";
    }
}
