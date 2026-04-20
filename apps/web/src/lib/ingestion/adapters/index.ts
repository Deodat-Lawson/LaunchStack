/**
 * Source Adapter Registry
 * Exports all adapters and a convenience function to get the right one.
 */

export { TextAdapter } from "./text-adapter";
export { DocxAdapter } from "./docx-adapter";
export { PptxAdapter } from "./pptx-adapter";
export { SpreadsheetAdapter } from "./spreadsheet-adapter";
export { ReadabilityAdapter } from "./readability-adapter";
export { HtmlAdapter } from "./html-adapter";
export { PdfAdapter } from "./pdf-adapter";
export { ImageAdapter } from "./image-adapter";
export { JsonExportAdapter, SlackExportAdapter } from "./slack-export-adapter";
export { ZipAdapter } from "./zip-adapter";
export { FallbackAdapter } from "./fallback-adapter";
export { DoclingIngestionAdapter } from "./docling-adapter";

import type { SourceAdapter } from "@launchstack/core/ingestion/types";
import { TextAdapter } from "./text-adapter";
import { DocxAdapter } from "./docx-adapter";
import { PptxAdapter } from "./pptx-adapter";
import { SpreadsheetAdapter } from "./spreadsheet-adapter";
import { ReadabilityAdapter } from "./readability-adapter";
import { HtmlAdapter } from "./html-adapter";
import { PdfAdapter } from "./pdf-adapter";
import { ImageAdapter } from "./image-adapter";
import { JsonExportAdapter } from "./slack-export-adapter";
import { ZipAdapter } from "./zip-adapter";
import { FallbackAdapter } from "./fallback-adapter";
import { DoclingIngestionAdapter } from "./docling-adapter";

// DoclingIngestionAdapter is first so it preempts mammoth/sheetjs for Office
// formats when OCR_WORKER_URL is configured. Its canHandle() returns false
// when the worker is not configured, so the legacy adapters take over.
const ADAPTERS: SourceAdapter[] = [
  new DoclingIngestionAdapter(),
  new PdfAdapter(),
  new DocxAdapter(),
  new PptxAdapter(),
  new SpreadsheetAdapter(),
  new ReadabilityAdapter(),
  new HtmlAdapter(),
  new ImageAdapter(),
  new TextAdapter(),
  new JsonExportAdapter(),
  new ZipAdapter(),
  new FallbackAdapter(), // last: handles any unknown MIME/extension
];

export function findAdapter(
  mimeType: string,
  extension: string,
  filename?: string,
): SourceAdapter | undefined {
  return ADAPTERS.find((a) => a.canHandle(mimeType, extension, filename));
}

export function getAllAdapters(): readonly SourceAdapter[] {
  return ADAPTERS;
}
