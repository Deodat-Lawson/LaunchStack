/**
 * Readability Adapter
 *
 * Uses Mozilla's Readability.js to extract clean article content from HTML,
 * then converts to Markdown via Turndown. Only activates for website uploads
 * (options.isWebsite === true). Falls back to HtmlAdapter for non-article pages
 * where Readability returns null.
 */

import type {
  SourceAdapter,
  SourceAdapterOptions,
  StandardizedDocument,
  StandardizedPage,
} from "../types";
import type { ExtractedTable } from "@launchstack/core/ocr/types";

export class ReadabilityAdapter implements SourceAdapter {
  readonly name = "ReadabilityAdapter";

  private static readonly MIME_TYPES = new Set(["text/html"]);
  private static readonly EXTENSIONS = new Set([".html", ".htm"]);

  canHandle(mimeType: string, extension: string): boolean {
    return (
      ReadabilityAdapter.MIME_TYPES.has(mimeType) ||
      ReadabilityAdapter.EXTENSIONS.has(extension.toLowerCase())
    );
  }

  async process(
    input: string | Buffer,
    options?: SourceAdapterOptions,
  ): Promise<StandardizedDocument> {
    const startTime = Date.now();
    const filename = options?.filename ?? "unknown";
    console.log(
      `[ReadabilityAdapter] Processing: file=${filename}, mime=${options?.mimeType ?? "none"}, isWebsite=${options?.isWebsite ?? false}`,
    );

    // Only use Readability for website uploads; delegate to HtmlAdapter otherwise
    if (!options?.isWebsite) {
      console.log("[ReadabilityAdapter] Not a website upload, delegating to HtmlAdapter");
      const { HtmlAdapter } = await import("./html-adapter");
      return new HtmlAdapter().process(input, options);
    }

    const html = await this.resolveHtml(input);
    console.log(`[ReadabilityAdapter] HTML loaded: ${html.length} chars`);

    // Try Readability extraction
    const article = await this.extractWithReadability(html);

    if (!article) {
      console.log(
        "[ReadabilityAdapter] Readability returned null (non-article page), falling back to HtmlAdapter",
      );
      const { HtmlAdapter } = await import("./html-adapter");
      return new HtmlAdapter().process(input, options);
    }

    console.log(
      `[ReadabilityAdapter] Readability extracted: title="${article.title}", ` +
        `byline="${article.byline ?? "none"}", content=${article.content.length} chars`,
    );

    // Convert article HTML to Markdown
    const markdown = await this.htmlToMarkdown(article.content);
    console.log(`[ReadabilityAdapter] Markdown: ${markdown.length} chars`);

    // Extract tables from the article HTML before converting to text
    const tables = await this.extractTables(article.content);

    // Split into page-like sections based on markdown headings or size
    const sections = this.splitIntoSections(markdown);

    const pages: StandardizedPage[] = sections.map((section, idx) => ({
      pageNumber: idx + 1,
      textBlocks: [section],
      tables: idx === 0 ? tables : [],
    }));

    if (pages.length === 0) {
      pages.push({
        pageNumber: 1,
        textBlocks: ["Empty document."],
        tables,
      });
    }

    const elapsed = Date.now() - startTime;
    console.log(
      `[ReadabilityAdapter] Done: ${pages.length} sections, ${tables.length} tables (${elapsed}ms)`,
    );

    return {
      pages,
      metadata: {
        sourceType: "html",
        totalPages: pages.length,
        provider: "readability",
        processingTimeMs: elapsed,
        confidenceScore: 95,
        originalFilename: options?.filename,
        mimeType: options?.mimeType,
      },
    };
  }

  private async extractWithReadability(
    html: string,
  ): Promise<{ title: string; byline: string | null; content: string; excerpt: string; siteName: string | null } | null> {
    const { JSDOM } = await import("jsdom");
    const { Readability } = await import("@mozilla/readability");

    const dom = new JSDOM(html, { url: "https://example.com" });
    const reader = new Readability(dom.window.document);
    const result = reader.parse();
    if (!result || !result.content || !result.title) return null;
    return {
      title: result.title,
      byline: result.byline ?? null,
      content: result.content,
      excerpt: result.excerpt ?? "",
      siteName: result.siteName ?? null,
    };
  }

  private async htmlToMarkdown(html: string): Promise<string> {
    const TurndownService = (await import("turndown")).default;
    const turndown = new TurndownService({
      headingStyle: "atx",
      codeBlockStyle: "fenced",
    });

    // Keep tables as HTML so we can extract them separately
    turndown.remove("script");
    turndown.remove("style");

    return turndown.turndown(html).trim();
  }

  private async extractTables(html: string): Promise<ExtractedTable[]> {
    const cheerio = await import("cheerio");
    const $ = cheerio.load(html);
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
    });

    return tables;
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

  private async resolveHtml(input: string | Buffer): Promise<string> {
    if (Buffer.isBuffer(input)) return input.toString("utf-8");
    if (
      input.startsWith("http://") ||
      input.startsWith("https://") ||
      input.startsWith("/")
    ) {
      const res = await fetch(input);
      if (!res.ok) throw new Error(`ReadabilityAdapter fetch failed: ${res.status}`);
      return res.text();
    }
    return input;
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
