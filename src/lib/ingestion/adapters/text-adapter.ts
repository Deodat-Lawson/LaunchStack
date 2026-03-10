import type {
  SourceAdapter,
  SourceAdapterOptions,
  StandardizedDocument,
} from "../types";

export class TextAdapter implements SourceAdapter {
  readonly name = "TextAdapter";

  private static readonly MIME_TYPES = new Set([
    "text/plain",
    "text/markdown",
  ]);

  private static readonly EXTENSIONS = new Set([
    ".txt",
    ".md",
    ".markdown",
    ".log",
    ".rst",
    ".adoc",
  ]);

  canHandle(mimeType: string, extension: string): boolean {
    return (
      TextAdapter.MIME_TYPES.has(mimeType) ||
      TextAdapter.EXTENSIONS.has(extension.toLowerCase())
    );
  }

  async process(
    input: string | Buffer,
    options?: SourceAdapterOptions,
  ): Promise<StandardizedDocument> {
    const startTime = Date.now();
    const inputType = Buffer.isBuffer(input) ? `buffer(${input.length}B)` : typeof input === "string" && (input.startsWith("http") || input.startsWith("/")) ? "url" : "raw_string";
    console.log(`[TextAdapter] Processing: file=${options?.filename ?? "unknown"}, mime=${options?.mimeType ?? "none"}, input=${inputType}`);

    const raw = await this.resolveInput(input);
    console.log(`[TextAdapter] Resolved input: ${raw.length} chars`);

    const PAGE_CHAR_LIMIT = 4000;
    const pages = this.splitIntoPages(raw, PAGE_CHAR_LIMIT);

    const isMarkdown =
      options?.mimeType === "text/markdown" ||
      (options?.filename?.endsWith(".md") ?? false) ||
      (options?.filename?.endsWith(".markdown") ?? false);

    const elapsed = Date.now() - startTime;
    console.log(`[TextAdapter] Done: ${pages.length} pages, type=${isMarkdown ? "markdown" : "text"} (${elapsed}ms)`);

    return {
      pages: pages.map((text, idx) => ({
        pageNumber: idx + 1,
        textBlocks: [text],
        tables: [],
      })),
      metadata: {
        sourceType: isMarkdown ? "markdown" : "text",
        totalPages: pages.length,
        provider: "native_text",
        processingTimeMs: elapsed,
        confidenceScore: 100,
        originalFilename: options?.filename,
        mimeType: options?.mimeType,
      },
    };
  }

  private async resolveInput(input: string | Buffer): Promise<string> {
    if (Buffer.isBuffer(input)) {
      return input.toString("utf-8");
    }
    if (input.startsWith("http://") || input.startsWith("https://") || input.startsWith("/")) {
      const res = await fetch(input);
      if (!res.ok) throw new Error(`TextAdapter fetch failed: ${res.status}`);
      return res.text();
    }
    return input;
  }

  private splitIntoPages(text: string, limit: number): string[] {
    if (text.length <= limit) return [text];

    const pages: string[] = [];
    let cursor = 0;

    while (cursor < text.length) {
      let end = Math.min(cursor + limit, text.length);
      if (end < text.length) {
        const lastPara = text.lastIndexOf("\n\n", end);
        if (lastPara > cursor + limit * 0.5) {
          end = lastPara + 2;
        }
      }
      pages.push(text.slice(cursor, end).trim());
      cursor = end;
    }

    return pages.filter((p) => p.length > 0);
  }
}
