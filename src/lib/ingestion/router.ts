/**
 * Ingestion Router
 *
 * Entry point for the Source Adapter pattern. Accepts any blob (URL or Buffer)
 * and routes it to the correct adapter to produce a StandardizedDocument.
 */

import { findAdapter } from "./adapters";
import {
  detectSourceType,
  toNormalizedDocument,
  type SourceAdapterOptions,
  type StandardizedDocument,
} from "./types";
import type { NormalizedDocument } from "~/lib/ocr/types";

export interface IngestOptions extends SourceAdapterOptions {
  mimeType?: string;
  filename?: string;
}

/**
 * Route a blob to the appropriate adapter and produce a StandardizedDocument.
 *
 * @param input - A URL (string) or file contents (Buffer)
 * @param options - MIME type, filename, and processing hints
 * @returns StandardizedDocument ready for chunking + vectorization
 * @throws Error if no adapter can handle the input
 */
export async function ingestDocument(
  input: string | Buffer,
  options: IngestOptions = {},
): Promise<StandardizedDocument> {
  const routerStart = Date.now();
  const mimeType = options.mimeType ?? "";
  const filename = options.filename ?? "";
  const extension = filename.includes(".")
    ? filename.slice(filename.lastIndexOf(".")).toLowerCase()
    : "";
  const inputType = typeof input === "string" ? `url(${input.substring(0, 80)})` : `buffer(${input.length} bytes)`;

  const sourceType = detectSourceType(mimeType, filename);

  console.log(
    `[IngestionRouter] Routing document: ` +
      `mime=${mimeType}, ext=${extension}, detected=${sourceType}, file=${filename}, input=${inputType}`,
  );

  const adapter = findAdapter(mimeType, extension);

  if (!adapter) {
    console.error(
      `[IngestionRouter] No adapter found for mime="${mimeType}" ext="${extension}"`,
    );
    throw new Error(
      `[IngestionRouter] No adapter found for mime="${mimeType}" ext="${extension}". ` +
        `Supported types: PDF, DOCX, XLSX, CSV, HTML, TXT, MD, PNG, JPG, TIFF, WEBP.`,
    );
  }

  console.log(`[IngestionRouter] Selected adapter: ${adapter.name}`);

  const adapterStart = Date.now();
  const result = await adapter.process(input, {
    ...options,
    mimeType,
    filename,
  });

  const adapterMs = Date.now() - adapterStart;
  const totalMs = Date.now() - routerStart;
  console.log(
    `[IngestionRouter] ${adapter.name} produced ${result.pages.length} pages, ` +
      `provider=${result.metadata.provider}, adapter=${adapterMs}ms, total=${totalMs}ms`,
  );

  return result;
}

/**
 * Convenience wrapper: ingest a document and return the legacy
 * NormalizedDocument format so existing code (chunker, storage) works unchanged.
 */
export async function ingestToNormalized(
  input: string | Buffer,
  options: IngestOptions = {},
): Promise<NormalizedDocument> {
  console.log(`[IngestionRouter] ingestToNormalized: converting to legacy NormalizedDocument format`);
  const doc = await ingestDocument(input, options);
  const convertStart = Date.now();
  const normalized = toNormalizedDocument(doc);
  console.log(
    `[IngestionRouter] toNormalizedDocument conversion: ${normalized.pages.length} pages, ` +
      `provider=${normalized.metadata.provider} (${Date.now() - convertStart}ms)`
  );
  return normalized;
}

/**
 * Check whether a given MIME type / filename is supported by the ingestion layer.
 */
export function isSupported(mimeType?: string, filename?: string): boolean {
  const mime = mimeType ?? "";
  const ext = filename?.includes(".")
    ? filename.slice(filename.lastIndexOf(".")).toLowerCase()
    : "";
  return !!findAdapter(mime, ext);
}
