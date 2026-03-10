import type {
  SourceAdapter,
  SourceAdapterOptions,
  StandardizedDocument,
  StandardizedPage,
} from "../types";
import type { ExtractedTable } from "~/lib/ocr/types";

export class HtmlAdapter implements SourceAdapter {
  readonly name = "HtmlAdapter";

  private static readonly MIME_TYPES = new Set(["text/html"]);
  private static readonly EXTENSIONS = new Set([".html", ".htm"]);

  canHandle(mimeType: string, extension: string): boolean {
    return (
      HtmlAdapter.MIME_TYPES.has(mimeType) ||
      HtmlAdapter.EXTENSIONS.has(extension.toLowerCase())
    );
  }

  async process(
    input: string | Buffer,
    options?: SourceAdapterOptions,
  ): Promise<StandardizedDocument> {
    const startTime = Date.now();
    console.log(`[HtmlAdapter] Processing: file=${options?.filename ?? "unknown"}, mime=${options?.mimeType ?? "none"}`);

    const cheerio = await import("cheerio");

    const html = await this.resolveHtml(input);
    console.log(`[HtmlAdapter] HTML loaded: ${html.length} chars`);

    const $ = cheerio.load(html);

    $("script, style, nav, footer, header, noscript, iframe, svg").remove();

    const tables: ExtractedTable[] = [];
    $("table").each((_i, table) => {
      const rows: string[][] = [];
      $(table)
        .find("tr")
        .each((_j, tr) => {
          const cells: string[] = [];
          $(tr)
            .find("th, td")
            .each((_k, cell) => {
              cells.push($(cell).text().trim());
            });
          if (cells.length > 0) rows.push(cells);
        });

      if (rows.length > 0) {
        tables.push({
          rows,
          markdown: this.rowsToMarkdown(rows),
          rowCount: rows.length,
          columnCount: rows[0]?.length ?? 0,
        });
      }

      // Remove table from DOM so it doesn't duplicate in text extraction
      $(table).remove();
    });
    console.log(`[HtmlAdapter] Extracted ${tables.length} tables from HTML`);

    // Extract text content
    const text = $("body").text().replace(/\s+/g, " ").trim();
    console.log(`[HtmlAdapter] Body text after strip: ${text.length} chars`);

    // Split into page-like sections
    const sections = this.splitIntoSections(text);

    const pages: StandardizedPage[] = sections.map((section, idx) => ({
      pageNumber: idx + 1,
      textBlocks: [section],
      tables: idx === 0 ? tables : [], // Attach tables to first page
    }));

    if (pages.length === 0) {
      console.warn("[HtmlAdapter] No content extracted, returning empty placeholder");
      pages.push({
        pageNumber: 1,
        textBlocks: ["Empty HTML document."],
        tables,
      });
    }

    const elapsed = Date.now() - startTime;
    console.log(`[HtmlAdapter] Done: ${pages.length} sections, ${tables.length} tables (${elapsed}ms)`);

    return {
      pages,
      metadata: {
        sourceType: "html",
        totalPages: pages.length,
        provider: "cheerio",
        processingTimeMs: elapsed,
        confidenceScore: 90,
        originalFilename: options?.filename,
        mimeType: options?.mimeType,
      },
    };
  }

  private async resolveHtml(input: string | Buffer): Promise<string> {
    if (Buffer.isBuffer(input)) return input.toString("utf-8");
    if (
      input.startsWith("http://") ||
      input.startsWith("https://") ||
      input.startsWith("/")
    ) {
      const res = await fetch(input);
      if (!res.ok) throw new Error(`HtmlAdapter fetch failed: ${res.status}`);
      return res.text();
    }
    return input;
  }

  private rowsToMarkdown(rows: string[][]): string {
    if (rows.length === 0) return "";
    const header = rows[0]!;
    const lines: string[] = [];
    lines.push(`| ${header.join(" | ")} |`);
    lines.push(`| ${header.map(() => "---").join(" | ")} |`);
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i]!;
      const cells = header.map((_, idx) => row[idx] ?? "");
      lines.push(`| ${cells.join(" | ")} |`);
    }
    return lines.join("\n");
  }

  private splitIntoSections(text: string): string[] {
    const LIMIT = 4000;
    if (text.length <= LIMIT) return [text];

    const sections: string[] = [];
    let cursor = 0;
    while (cursor < text.length) {
      let end = Math.min(cursor + LIMIT, text.length);
      if (end < text.length) {
        const lastSpace = text.lastIndexOf(" ", end);
        if (lastSpace > cursor + LIMIT * 0.5) end = lastSpace;
      }
      const section = text.slice(cursor, end).trim();
      if (section.length > 0) sections.push(section);
      cursor = end;
    }
    return sections;
  }
}
