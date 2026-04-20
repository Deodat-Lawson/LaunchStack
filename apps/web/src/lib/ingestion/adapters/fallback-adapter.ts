/**
 * Fallback adapter for unknown file types.
 * Accepts any MIME/extension not handled by other adapters and does best-effort
 * text extraction (UTF-8 decode) so "upload all types" still runs through the pipeline.
 */

import type {
  SourceAdapter,
  SourceAdapterOptions,
  StandardizedDocument,
} from "../types";
import { detectSourceType } from "../types";

const PAGE_CHAR_LIMIT = 4000;
const BINARY_THRESHOLD = 0.3; // treat as binary if >30% non-printable/replacement

export class FallbackAdapter implements SourceAdapter {
  readonly name = "FallbackAdapter";

  canHandle(mimeType: string, extension: string): boolean {
    const filename = extension ? `file${extension}` : "file";
    return detectSourceType(mimeType, filename) === "unknown";
  }

  async process(
    input: string | Buffer,
    options?: SourceAdapterOptions,
  ): Promise<StandardizedDocument> {
    const startTime = Date.now();
    const filename = options?.filename ?? "unknown";
    const mimeType = options?.mimeType ?? "application/octet-stream";
    console.log(
      `[FallbackAdapter] Processing unknown type: file=${filename}, mime=${mimeType}`,
    );

    const buffer = await this.resolveToBuffer(input);
    const raw = buffer.toString("utf-8");
    const looksBinary = this.looksBinary(raw);

    let pages: { pageNumber: number; textBlocks: string[]; tables: [] }[];
    if (looksBinary) {
      console.log(`[FallbackAdapter] Content appears binary, emitting placeholder page`);
      pages = [
        {
          pageNumber: 1,
          textBlocks: [
            `[Binary or unsupported format: ${mimeType}] No text extracted. File: ${filename}`,
          ],
          tables: [],
        },
      ];
    } else {
      pages = this.splitIntoPages(raw, PAGE_CHAR_LIMIT).map((text, idx) => ({
        pageNumber: idx + 1,
        textBlocks: [text],
        tables: [],
      }));
    }

    const elapsed = Date.now() - startTime;
    console.log(
      `[FallbackAdapter] Done: ${pages.length} pages, binary=${looksBinary} (${elapsed}ms)`,
    );

    return {
      pages,
      metadata: {
        sourceType: "unknown",
        totalPages: pages.length,
        provider: "native_text",
        processingTimeMs: elapsed,
        confidenceScore: looksBinary ? 0 : 50,
        originalFilename: filename,
        mimeType,
      },
    };
  }

  private async resolveToBuffer(input: string | Buffer): Promise<Buffer> {
    if (Buffer.isBuffer(input)) return input;
    if (
      typeof input === "string" &&
      (input.startsWith("http://") ||
        input.startsWith("https://") ||
        input.startsWith("/"))
    ) {
      const res = await fetch(input);
      if (!res.ok) throw new Error(`FallbackAdapter fetch failed: ${res.status}`);
      const ab = await res.arrayBuffer();
      return Buffer.from(ab);
    }
    return Buffer.from(input, "utf-8");
  }

  private looksBinary(text: string): boolean {
    if (text.length === 0) return true;
    let bad = 0;
    const sample = text.length > 10000 ? text.slice(0, 10000) : text;
    for (const c of sample) {
      if (c === "\uFFFD" || c === "\0") bad++;
    }
    return bad / sample.length > BINARY_THRESHOLD;
  }

  private splitIntoPages(text: string, limit: number): string[] {
    const trimmed = text.trim();
    if (trimmed.length <= limit) return trimmed.length ? [trimmed] : [];

    const pages: string[] = [];
    let cursor = 0;
    while (cursor < trimmed.length) {
      let end = Math.min(cursor + limit, trimmed.length);
      if (end < trimmed.length) {
        const lastPara = trimmed.lastIndexOf("\n\n", end);
        if (lastPara > cursor + limit * 0.5) end = lastPara + 2;
      }
      const chunk = trimmed.slice(cursor, end).trim();
      if (chunk.length) pages.push(chunk);
      cursor = end;
    }
    return pages;
  }
}
