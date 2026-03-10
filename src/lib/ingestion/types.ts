/**
 * Unified Document Ingestion Types
 */

import type { PageContent, NormalizedDocument, ExtractedTable } from "~/lib/ocr/types";

export type SourceType =
  | "pdf"
  | "image"
  | "docx"
  | "xlsx"
  | "csv"
  | "pptx"
  | "text"
  | "markdown"
  | "html"
  | "email"
  | "unknown";

export type IngestionProvider =
  | "native_text"
  | "native_pdf"
  | "mammoth"
  | "sheetjs"
  | "cheerio"
  | "azure"
  | "landing_ai"
  | "tesseract"
  | "sidecar";

export interface StandardizedDocument {
  pages: StandardizedPage[];
  metadata: StandardizedMetadata;
}

export interface StandardizedPage {
  pageNumber: number;
  textBlocks: string[];
  tables: ExtractedTable[];
  coordinates?: LayoutCoordinate[];
}

export interface StandardizedMetadata {
  sourceType: SourceType;
  totalPages: number;
  provider: IngestionProvider;
  processingTimeMs: number;
  confidenceScore?: number;
  originalFilename?: string;
  mimeType?: string;
}

export interface LayoutCoordinate {
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
}

// ============================================================================
// Source Adapter Interface
// ============================================================================

export interface SourceAdapter {
  readonly name: string;
  canHandle(mimeType: string, extension: string): boolean;
  process(
    input: string | Buffer,
    options?: SourceAdapterOptions,
  ): Promise<StandardizedDocument>;
}

export interface SourceAdapterOptions {
  filename?: string;
  mimeType?: string;
  forceOCR?: boolean;
  language?: string;
}

// ============================================================================
// MIME / Extension Mapping Helpers
// ============================================================================

export const MIME_TO_SOURCE_TYPE: Record<string, SourceType> = {
  "application/pdf": "pdf",
  "application/zip": "unknown",
  "image/png": "image",
  "image/jpeg": "image",
  "image/jpg": "image",
  "image/tiff": "image",
  "image/webp": "image",
  "image/gif": "image",
  "image/bmp": "image",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/msword": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-excel": "xlsx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/vnd.ms-powerpoint": "pptx",
  "text/plain": "text",
  "text/markdown": "markdown",
  "text/html": "html",
  "text/csv": "csv",
  "application/csv": "csv",
  "message/rfc822": "email",
  "application/vnd.ms-outlook": "email",
};

export const EXTENSION_TO_SOURCE_TYPE: Record<string, SourceType> = {
  ".pdf": "pdf",
  ".zip": "unknown",
  ".png": "image",
  ".jpg": "image",
  ".jpeg": "image",
  ".tiff": "image",
  ".tif": "image",
  ".webp": "image",
  ".gif": "image",
  ".bmp": "image",
  ".docx": "docx",
  ".doc": "docx",
  ".xlsx": "xlsx",
  ".xls": "xlsx",
  ".csv": "csv",
  ".pptx": "pptx",
  ".ppt": "pptx",
  ".txt": "text",
  ".md": "markdown",
  ".markdown": "markdown",
  ".html": "html",
  ".htm": "html",
  ".eml": "email",
  ".msg": "email",
};

export const ALLOWED_MIME_TYPES: string[] = Object.keys(MIME_TO_SOURCE_TYPE);

export function detectSourceType(
  mimeType?: string,
  filename?: string,
): SourceType {
  if (mimeType && MIME_TO_SOURCE_TYPE[mimeType]) {
    return MIME_TO_SOURCE_TYPE[mimeType];
  }

  if (filename) {
    const ext = filename.slice(filename.lastIndexOf(".")).toLowerCase();
    if (EXTENSION_TO_SOURCE_TYPE[ext]) {
      return EXTENSION_TO_SOURCE_TYPE[ext];
    }
  }

  return "unknown";
}

export function toNormalizedDocument(doc: StandardizedDocument): NormalizedDocument {
  const pages: PageContent[] = doc.pages.map((p) => ({
    pageNumber: p.pageNumber,
    textBlocks: p.textBlocks,
    tables: p.tables,
  }));

  const providerMap: Record<string, string> = {
    native_text: "NATIVE_PDF",
    native_pdf: "NATIVE_PDF",
    mammoth: "NATIVE_PDF",
    sheetjs: "NATIVE_PDF",
    cheerio: "NATIVE_PDF",
    azure: "AZURE",
    landing_ai: "LANDING_AI",
    tesseract: "NATIVE_PDF",
    sidecar: "AZURE",
  };

  return {
    pages,
    metadata: {
      totalPages: doc.metadata.totalPages,
      provider: (providerMap[doc.metadata.provider] ?? "NATIVE_PDF") as "AZURE" | "LANDING_AI" | "NATIVE_PDF" | "DATALAB",
      processingTimeMs: doc.metadata.processingTimeMs,
      confidenceScore: doc.metadata.confidenceScore,
    },
  };
}
