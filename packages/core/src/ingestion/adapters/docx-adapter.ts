import type {
  SourceAdapter,
  SourceAdapterOptions,
  StandardizedDocument,
  StandardizedPage,
} from "../types";

export class DocxAdapter implements SourceAdapter {
  readonly name = "DocxAdapter";

  private static readonly MIME_TYPES = new Set([
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/msword",
  ]);

  private static readonly EXTENSIONS = new Set([".docx", ".doc"]);

  canHandle(mimeType: string, extension: string): boolean {
    return (
      DocxAdapter.MIME_TYPES.has(mimeType) ||
      DocxAdapter.EXTENSIONS.has(extension.toLowerCase())
    );
  }

  async process(
    input: string | Buffer,
    options?: SourceAdapterOptions,
  ): Promise<StandardizedDocument> {
    const startTime = Date.now();
    console.log(`[DocxAdapter] Processing: file=${options?.filename ?? "unknown"}, mime=${options?.mimeType ?? "none"}`);

    const mammoth = await import("mammoth");
    const buffer = await this.resolveBuffer(input);
    console.log(`[DocxAdapter] Buffer resolved: ${buffer.length} bytes`);

    const result = await mammoth.convertToHtml({ buffer });
    const html = result.value;
    console.log(`[DocxAdapter] Mammoth HTML output: ${html.length} chars, warnings=${result.messages.length}`);

    if (result.messages.length > 0) {
      console.warn(
        `[DocxAdapter] Conversion warnings (${result.messages.length}):`,
        result.messages.map((m) => m.message).join("; "),
      );
    }

    const text = this.htmlToText(html);
    console.log(`[DocxAdapter] Extracted text: ${text.length} chars`);

    const sections = this.splitIntoSections(text);

    const pages: StandardizedPage[] = sections.map((section, idx) => ({
      pageNumber: idx + 1,
      textBlocks: [section],
      tables: [],
    }));

    const elapsed = Date.now() - startTime;
    console.log(`[DocxAdapter] Done: ${pages.length} sections/pages (${elapsed}ms)`);

    return {
      pages,
      metadata: {
        sourceType: "docx",
        totalPages: pages.length,
        provider: "mammoth",
        processingTimeMs: elapsed,
        confidenceScore: 95,
        originalFilename: options?.filename,
        mimeType: options?.mimeType,
      },
    };
  }

  private async resolveBuffer(input: string | Buffer): Promise<Buffer> {
    if (Buffer.isBuffer(input)) return input;

    const res = await fetch(input);
    if (!res.ok) throw new Error(`DocxAdapter fetch failed: ${res.status}`);
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
  }

  private htmlToText(html: string): string {
    let text = html;

    text = text.replace(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/gi, "\n\n$1\n\n");
    text = text.replace(/<\/(p|div)>/gi, "\n\n");
    text = text.replace(/<(p|div)[^>]*>/gi, "");
    text = text.replace(/<br\s*\/?>/gi, "\n");
    text = text.replace(/<li[^>]*>/gi, "\n- ");
    text = text.replace(/<\/li>/gi, "");
    text = text.replace(/<[^>]+>/g, "");

    text = text
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, " ");

    text = text.replace(/\n{3,}/g, "\n\n").trim();

    return text;
  }

  private splitIntoSections(text: string): string[] {
    const LIMIT = 4000;
    if (text.length <= LIMIT) return [text];

    const sections: string[] = [];
    let cursor = 0;

    while (cursor < text.length) {
      let end = Math.min(cursor + LIMIT, text.length);
      if (end < text.length) {
        const lastPara = text.lastIndexOf("\n\n", end);
        if (lastPara > cursor + LIMIT * 0.5) {
          end = lastPara + 2;
        }
      }
      const section = text.slice(cursor, end).trim();
      if (section.length > 0) sections.push(section);
      cursor = end;
    }

    return sections;
  }
}
