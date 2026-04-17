/**
 * Docling Ingestion Adapter
 *
 * Routes Office / broad-format documents (DOCX, PPTX, XLSX, EPUB)
 * through the self-hosted OSS ocr-worker running Docling.
 *
 * This adapter is only enabled when OCR_WORKER_URL is set, and it is
 * registered *before* the built-in mammoth/sheetjs adapters in
 * [src/lib/ingestion/adapters/index.ts] so it preempts them. When the worker
 * is unreachable, findAdapter will fall through to the legacy adapters.
 */

import type {
  SourceAdapter,
  SourceAdapterOptions,
  StandardizedDocument,
  StandardizedPage,
} from "../types";
import { createDoclingAdapter } from "~/lib/ocr/adapters/ossAdapter";

const OFFICE_MIMES = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/epub+zip",
]);

const OFFICE_EXTS = new Set([
  ".docx",
  ".doc",
  ".pptx",
  ".ppt",
  ".xlsx",
  ".xls",
  ".epub",
]);

export class DoclingIngestionAdapter implements SourceAdapter {
  readonly name = "DoclingIngestionAdapter";
  readonly needsUrl = true;

  canHandle(mimeType: string, extension: string): boolean {
    if (!process.env.OCR_WORKER_URL) return false;
    return OFFICE_MIMES.has(mimeType) || OFFICE_EXTS.has(extension.toLowerCase());
  }

  async process(
    input: string | Buffer,
    options?: SourceAdapterOptions,
  ): Promise<StandardizedDocument> {
    const startTime = Date.now();
    const filename = options?.filename ?? "document";
    console.log(`[DoclingIngestionAdapter] Processing: file=${filename}, mime=${options?.mimeType ?? "none"}`);

    if (Buffer.isBuffer(input)) {
      throw new Error(
        "[DoclingIngestionAdapter] Buffer input not supported — worker needs a fetchable URL. " +
          "Ensure the ingestion router passes a URL, or the worker must be granted direct access.",
      );
    }

    const adapter = createDoclingAdapter();
    const normalized = await adapter.uploadDocument(input);

    const pages: StandardizedPage[] = normalized.pages.map((p) => ({
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

  private inferSourceType(
    mime?: string,
    filename?: string,
  ): StandardizedDocument["metadata"]["sourceType"] {
    const ext = filename?.includes(".") ? filename.slice(filename.lastIndexOf(".")).toLowerCase() : "";
    if (ext === ".docx" || ext === ".doc" || mime?.includes("wordprocessingml")) return "docx";
    if (ext === ".pptx" || ext === ".ppt" || mime?.includes("presentationml")) return "pptx";
    if (ext === ".xlsx" || ext === ".xls" || mime?.includes("spreadsheetml")) return "xlsx";
    if (ext === ".html" || ext === ".htm" || mime?.includes("html")) return "html";
    return "docx";
  }
}
