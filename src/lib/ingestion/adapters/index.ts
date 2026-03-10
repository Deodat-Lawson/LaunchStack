/**
 * Source Adapter Registry
 * Exports all adapters and a convenience function to get the right one.
 */

export { TextAdapter } from "./text-adapter";
export { DocxAdapter } from "./docx-adapter";
export { PptxAdapter } from "./pptx-adapter";
export { SpreadsheetAdapter } from "./spreadsheet-adapter";
export { HtmlAdapter } from "./html-adapter";
export { PdfAdapter } from "./pdf-adapter";
export { ImageAdapter } from "./image-adapter";
export { FallbackAdapter } from "./fallback-adapter";

import type { SourceAdapter } from "../types";
import { TextAdapter } from "./text-adapter";
import { DocxAdapter } from "./docx-adapter";
import { PptxAdapter } from "./pptx-adapter";
import { SpreadsheetAdapter } from "./spreadsheet-adapter";
import { HtmlAdapter } from "./html-adapter";
import { PdfAdapter } from "./pdf-adapter";
import { ImageAdapter } from "./image-adapter";
import { FallbackAdapter } from "./fallback-adapter";

const ADAPTERS: SourceAdapter[] = [
  new PdfAdapter(),
  new DocxAdapter(),
  new PptxAdapter(),
  new SpreadsheetAdapter(),
  new HtmlAdapter(),
  new ImageAdapter(),
  new TextAdapter(),
  new FallbackAdapter(), // last: handles any unknown MIME/extension
];

export function findAdapter(
  mimeType: string,
  extension: string,
): SourceAdapter | undefined {
  return ADAPTERS.find((a) => a.canHandle(mimeType, extension));
}

export function getAllAdapters(): readonly SourceAdapter[] {
  return ADAPTERS;
}
