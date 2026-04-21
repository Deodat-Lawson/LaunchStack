import type {
  SourceAdapter,
  SourceAdapterOptions,
  StandardizedDocument,
  StandardizedPage,
} from "../types";

export class PptxAdapter implements SourceAdapter {
  readonly name = "PptxAdapter";

  private static readonly MIME_TYPES = new Set([
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.ms-powerpoint",
  ]);

  private static readonly EXTENSIONS = new Set([".pptx", ".ppt"]);

  canHandle(mimeType: string, extension: string): boolean {
    return (
      PptxAdapter.MIME_TYPES.has(mimeType) ||
      PptxAdapter.EXTENSIONS.has(extension.toLowerCase())
    );
  }

  async process(
    input: string | Buffer,
    options?: SourceAdapterOptions,
  ): Promise<StandardizedDocument> {
    const startTime = Date.now();
    console.log(
      `[PptxAdapter] Processing: file=${options?.filename ?? "unknown"}, mime=${options?.mimeType ?? "none"}`,
    );

    const JSZip = (await import("jszip")).default;

    // #region agent log
    try {
      const typeGlobalFile = typeof global.File;
      const typeGlobalThisFile = typeof globalThis.File;
      await fetch('http://127.0.0.1:7243/ingest/bcb599e5-0995-455d-900a-f795e258dd22',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'pptx-adapter.ts:35',message:'Before polyfill',data:{typeGlobalFile, typeGlobalThisFile, nodeVersion: process.version},timestamp:Date.now()})}).catch(() => void 0);
    } catch {}
    // #endregion

    // Polyfill File for Node.js < 20 (required by cheerio/undici)
    if (!globalThis.File) {
      const { File } = await import("node:buffer");
      // @ts-expect-error - polyfill File for Node.js < 20 environment
      globalThis.File = File;
      // @ts-expect-error - polyfill File for Node.js < 20 environment
      global.File = File;
    }

    // #region agent log
    try {
      const typeGlobalFile = typeof global.File;
      const typeGlobalThisFile = typeof globalThis.File;
      await fetch('http://127.0.0.1:7243/ingest/bcb599e5-0995-455d-900a-f795e258dd22',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'pptx-adapter.ts:47',message:'After polyfill',data:{typeGlobalFile, typeGlobalThisFile},timestamp:Date.now()})}).catch(() => void 0);
    } catch {}
    // #endregion

    const cheerio = await import("cheerio");

    const buffer = await this.resolveBuffer(input);
    console.log(`[PptxAdapter] Buffer resolved: ${buffer.length} bytes`);

    const zip = await JSZip.loadAsync(buffer);

    // Discover slide files (ppt/slides/slide1.xml, slide2.xml, …)
    const slideEntries = Object.keys(zip.files)
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
      .sort((a, b) => {
        const slideNumRegex = /slide(\d+)/i;
        const numA = parseInt(slideNumRegex.exec(a)?.[1] ?? "0", 10);
        const numB = parseInt(slideNumRegex.exec(b)?.[1] ?? "0", 10);
        return numA - numB;
      });

    console.log(`[PptxAdapter] Found ${slideEntries.length} slides in ZIP`);

    const pages: StandardizedPage[] = [];

    for (let i = 0; i < slideEntries.length; i++) {
      const entry = slideEntries[i]!;
      const xml = await zip.files[entry]!.async("text");

      // cheerio is XML-mode capable; use xmlMode to parse slide XML
      const $ = cheerio.load(xml, { xmlMode: true });

      // Extract all text runs (<a:t> elements hold the actual text)
      const textParts: string[] = [];
      $("a\\:t, t").each((_idx, el) => {
        const text = $(el).text().trim();
        if (text.length > 0) {
          textParts.push(text);
        }
      });

      const slideText = textParts.join(" ").trim();
      console.log(
        `[PptxAdapter] Slide ${i + 1}: ${textParts.length} text runs, ${slideText.length} chars`,
      );

      pages.push({
        pageNumber: i + 1,
        textBlocks: slideText.length > 0
          ? [slideText]
          : [`[Slide ${i + 1}: no text content]`],
        tables: [],
      });
    }

    // If the PPTX has no slides at all, return a placeholder
    if (pages.length === 0) {
      console.warn("[PptxAdapter] No slides found in PPTX file");
      pages.push({
        pageNumber: 1,
        textBlocks: ["Empty presentation — no slides found."],
        tables: [],
      });
    }

    const elapsed = Date.now() - startTime;
    console.log(
      `[PptxAdapter] Done: ${pages.length} slides extracted (${elapsed}ms)`,
    );

    return {
      pages,
      metadata: {
        sourceType: "pptx",
        totalPages: pages.length,
        provider: "native_text",
        processingTimeMs: elapsed,
        confidenceScore: 85,
        originalFilename: options?.filename,
        mimeType: options?.mimeType,
      },
    };
  }

  private async resolveBuffer(input: string | Buffer): Promise<Buffer> {
    if (Buffer.isBuffer(input)) return input;

    const res = await fetch(input);
    if (!res.ok) {
      throw new Error(`PptxAdapter fetch failed: ${res.status}`);
    }
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
  }
}
