/**
 * OSS OCR Adapter — calls services/document-converter's `POST /convert`
 * (the ADR-004 consolidation of the old ocr-worker), which proxies
 * docling-serve and returns a typed EvidenceDocument.
 *
 * Honesty rules (ADR-004): `confidenceScore` is set ONLY when the
 * EvidenceDocument carries a provider-reported `confidence` ([0,1] scale,
 * kept as-is). The old fabricated worker constant (92) must not reappear.
 */

import { z } from "zod";

import type {
  OCRAdapter,
  OCRAdapterOptions,
  NormalizedDocument,
  PageContent,
  ExtractedTable,
  OCRProvider,
} from "../types";
import { getOcrConfig } from "../config";

/** Wire schemaVersion of the frozen converter contract (packages/protocol). */
const SCHEMA_VERSION = 1;

// Docling on CPU can be slow on first run (model download + inference).
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Local mirror of the frozen EvidenceDocument wire schema
 * (packages/protocol/src/evidence-document.ts), validated on receipt.
 */
const layoutBlockSchema = z.object({
  type: z.enum([
    "heading",
    "paragraph",
    "list",
    "table",
    "figure",
    "caption",
    "code",
    "header",
    "footer",
    "footnote",
    "other",
  ]),
  text: z.string(),
  confidence: z.number().min(0).max(1).optional(),
});

const evidencePageSchema = z.object({
  pageNumber: z.number().int().positive(),
  text: z.string(),
  blocks: z.array(layoutBlockSchema).optional(),
});

const evidenceDocumentSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  provider: z.string().min(1),
  source: z.object({
    filename: z.string().optional(),
    mimeType: z.string().optional(),
    pageCount: z.number().int().nonnegative().optional(),
  }),
  /** Provider-reported document-level confidence in [0,1], when available. */
  confidence: z.number().min(0).max(1).optional(),
  pages: z.array(evidencePageSchema),
  markdown: z.string().optional(),
  warnings: z.array(z.string()),
});

type EvidenceDocument = z.infer<typeof evidenceDocumentSchema>;

/** A markdown-table-separator cell: `---`, `:---`, `---:`, `:---:`. */
const SEPARATOR_CELL = /^:?-+:?$/;

/**
 * Parse a markdown pipe table (the `text` of a "table" layout block) into the
 * ExtractedTable shape downstream chunking reads: `rows` (headers included,
 * separator row dropped), `markdown`, `rowCount`, `columnCount`.
 */
export function parseMarkdownTable(markdown: string): ExtractedTable {
  const rows: string[][] = [];
  for (const rawLine of markdown.split("\n")) {
    const line = rawLine.trim();
    if (line.length < 2 || !line.startsWith("|") || !line.endsWith("|")) {
      continue;
    }
    const cells = line
      .slice(1, -1)
      .split("|")
      .map((cell) => cell.trim());
    if (cells.length > 0 && cells.every((cell) => SEPARATOR_CELL.test(cell))) {
      continue; // alignment separator row, not data
    }
    rows.push(cells);
  }

  return {
    rows,
    markdown,
    rowCount: rows.length,
    columnCount: rows.reduce((max, row) => Math.max(max, row.length), 0),
  };
}

/**
 * Map the converter's EvidenceDocument into the adapter's internal
 * NormalizedDocument shape: per-page textBlocks (non-table blocks, or the
 * page's full text when no blocks were supplied) and tables parsed from
 * "table" layout blocks.
 */
function evidenceToNormalizedDocument(
  evidence: EvidenceDocument,
  processingTimeMs: number
): NormalizedDocument {
  const pages: PageContent[] = evidence.pages.map((page) => {
    const blocks = page.blocks ?? [];
    const tables = blocks
      .filter((block) => block.type === "table")
      .map((block) => parseMarkdownTable(block.text));
    const textBlocks =
      blocks.length > 0
        ? blocks
            .filter((block) => block.type !== "table")
            .map((block) => block.text)
            .filter((text) => text.trim().length > 0)
        : page.text.trim().length > 0
          ? [page.text]
          : [];

    return { pageNumber: page.pageNumber, textBlocks, tables };
  });

  return {
    pages,
    metadata: {
      totalPages: evidence.source.pageCount ?? pages.length,
      provider: "DOCLING",
      processingTimeMs,
      // Provider-reported [0,1] confidence only; absent stays absent.
      ...(evidence.confidence !== undefined
        ? { confidenceScore: evidence.confidence }
        : {}),
    },
  };
}

class OssOCRAdapter implements OCRAdapter {
  private readonly converterUrl?: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor(converterUrl?: string, timeoutMs?: number) {
    const converter = getOcrConfig().converter;
    this.converterUrl = (converterUrl ?? converter?.url)?.replace(/\/+$/, "");
    this.apiKey = converter?.apiKey ?? "";
    this.timeoutMs = timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  getProviderName(): OCRProvider {
    return "DOCLING";
  }

  async uploadDocument(
    documentUrl: string,
    _options?: OCRAdapterOptions
  ): Promise<NormalizedDocument> {
    if (!this.converterUrl) {
      throw new Error(
        "Document converter not configured: set DOCUMENT_CONVERTER_URL (and " +
          "DOCUMENT_CONVERTER_API_KEY) to reach services/document-converter (ADR-004)."
      );
    }

    const startTime = Date.now();
    const absoluteUrl = this.toConverterReachableUrl(documentUrl);
    const filename = documentUrl.split("/").pop()?.split("?")[0];

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await fetch(`${this.converterUrl}/convert`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.apiKey,
        },
        body: JSON.stringify({
          schemaVersion: SCHEMA_VERSION,
          url: absoluteUrl,
          ...(filename ? { filename } : {}),
        }),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      throw new Error(
        `Document converter unreachable at ${this.converterUrl}: ${(err as Error).message}`
      );
    }
    clearTimeout(timer);

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `Document converter /convert failed: ${response.status} ${response.statusText} — ${body.slice(0, 500)}`
      );
    }

    const evidence = evidenceDocumentSchema.parse(await response.json());
    for (const warning of evidence.warnings) {
      console.warn(`[OssOCRAdapter] converter warning: ${warning}`);
    }

    return evidenceToNormalizedDocument(evidence, Date.now() - startTime);
  }

  async extractPage(documentUrl: string, pageNumber: number): Promise<PageContent> {
    const doc = await this.uploadDocument(documentUrl);
    const page = doc.pages.find((p) => p.pageNumber === pageNumber);
    if (!page) throw new Error(`Page ${pageNumber} not found in document`);
    return page;
  }

  /**
   * The converter runs in a separate container and cannot resolve Next.js
   * internal routes like /api/files/123. Rewrite relative URLs so it can
   * fetch them via the app's public origin (which must be present in the
   * converter's own ALLOWED_FETCH_ORIGINS).
   */
  private toConverterReachableUrl(url: string): string {
    if (/^https?:\/\//i.test(url)) return url;
    const base = getOcrConfig().appPublicUrl ?? "http://app:3000";
    return new URL(url, base).toString();
  }
}

export function createDoclingAdapter(converterUrl?: string): OssOCRAdapter {
  return new OssOCRAdapter(converterUrl);
}

export { OssOCRAdapter };
