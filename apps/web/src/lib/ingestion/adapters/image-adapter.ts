/**
 * Image Adapter - Handles image files (PNG, JPG, TIFF, etc.)
 * Routes to Azure Document Intelligence, Landing.AI, or Tesseract (open-source fallback).
 * AI parser: may call external services.
 */

import type {
  SourceAdapter,
  SourceAdapterOptions,
  StandardizedDocument,
  IngestionProvider,
} from "../types";

export class ImageAdapter implements SourceAdapter {
  readonly name = "ImageAdapter";

  private static readonly MIME_TYPES = new Set([
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/tiff",
    "image/webp",
    "image/gif",
    "image/bmp",
  ]);

  private static readonly EXTENSIONS = new Set([
    ".png",
    ".jpg",
    ".jpeg",
    ".tiff",
    ".tif",
    ".webp",
    ".gif",
    ".bmp",
  ]);

  canHandle(mimeType: string, extension: string): boolean {
    return (
      ImageAdapter.MIME_TYPES.has(mimeType) ||
      ImageAdapter.EXTENSIONS.has(extension.toLowerCase())
    );
  }

  async process(
    input: string | Buffer,
    options?: SourceAdapterOptions,
  ): Promise<StandardizedDocument> {
    const startTime = Date.now();
    console.log(`[ImageAdapter] Processing: file=${options?.filename ?? "unknown"}, mime=${options?.mimeType ?? "none"}`);

    // Determine which OCR provider to use based on available credentials.
    // Priority: Landing.AI > Azure > Tesseract (open-source fallback)
    const provider = this.selectProvider();
    console.log(`[ImageAdapter] Selected OCR provider: ${provider}`);

    let pages: { pageNumber: number; textBlocks: string[]; tables: never[] }[];
    let providerName: IngestionProvider;

    const ocrStart = Date.now();
    switch (provider) {
      case "landing_ai": {
        console.log("[ImageAdapter] Calling Landing.AI...");
        const result = await this.processWithLandingAI(input);
        pages = result.pages;
        providerName = "azure";
        break;
      }
      case "azure": {
        console.log("[ImageAdapter] Calling Azure Document Intelligence...");
        const result = await this.processWithAzure(input);
        pages = result.pages;
        providerName = "landing_ai";
        break;
      }
      default: {
        console.log("[ImageAdapter] Falling back to Tesseract.js (local OCR)...");
        const result = await this.processWithTesseract(input);
        pages = result.pages;
        providerName = "tesseract";
        break;
      }
    }
    const ocrMs = Date.now() - ocrStart;

    const textLen = pages.reduce((s, p) => s + p.textBlocks.join("").length, 0);
    const elapsed = Date.now() - startTime;
    console.log(
      `[ImageAdapter] Done: provider=${providerName}, pages=${pages.length}, ` +
      `textChars=${textLen}, ocr=${ocrMs}ms, total=${elapsed}ms`
    );

    return {
      pages,
      metadata: {
        sourceType: "image",
        totalPages: pages.length,
        provider: providerName,
        processingTimeMs: elapsed,
        confidenceScore: provider === "tesseract" ? 60 : 85,
        originalFilename: options?.filename,
        mimeType: options?.mimeType,
      },
    };
  }

  // TODO: Make this select based on a workflow determining which is best
  private selectProvider(): "azure" | "landing_ai" | "tesseract" {
    if (process.env.LANDING_AI_API_KEY) {
      return "landing_ai";
    }
    if (
      process.env.AZURE_DOC_INTELLIGENCE_ENDPOINT &&
      process.env.AZURE_DOC_INTELLIGENCE_KEY
    ) {
      return "azure";
    }
    return "tesseract";
  }

  private async processWithAzure(input: string | Buffer) {
    const { createAzureAdapter } = await import("~/lib/ocr/adapters");
    const adapter = createAzureAdapter();

    const url = this.resolveUrl(input);
    const doc = await adapter.uploadDocument(url);

    return {
      pages: doc.pages.map((p) => ({
        pageNumber: p.pageNumber,
        textBlocks: p.textBlocks,
        tables: [] as never[],
      })),
    };
  }

  private async processWithLandingAI(input: string | Buffer) {
    const { createLandingAIAdapter } = await import("~/lib/ocr/adapters");
    const adapter = createLandingAIAdapter();

    const url = this.resolveUrl(input);
    const doc = await adapter.uploadDocument(url);

    return {
      pages: doc.pages.map((p) => ({
        pageNumber: p.pageNumber,
        textBlocks: p.textBlocks,
        tables: [] as never[],
      })),
    };
  }

  private async processWithTesseract(input: string | Buffer) {
    try {
      const Tesseract = await import("tesseract.js");

      let imageData: string | Buffer;
      if (Buffer.isBuffer(input)) {
        imageData = input;
      } else {
        const res = await fetch(input);
        if (!res.ok)
          throw new Error(`ImageAdapter fetch failed: ${res.status}`);
        const ab = await res.arrayBuffer();
        imageData = Buffer.from(ab);
      }

      const worker = await Tesseract.createWorker("eng");
      const result = await worker.recognize(imageData);
      await worker.terminate();

      const text = result.data.text.trim();

      return {
        pages: [
          {
            pageNumber: 1,
            textBlocks: text.length > 0 ? [text] : ["[No text detected in image]"],
            tables: [] as never[],
          },
        ],
      };
    } catch (error) {
      console.warn(
        "[ImageAdapter] Tesseract failed, returning empty result:",
        error instanceof Error ? error.message : error,
      );
      return {
        pages: [
          {
            pageNumber: 1,
            textBlocks: ["[OCR not available — install tesseract.js or configure Azure/Landing.AI]"],
            tables: [] as never[],
          },
        ],
      };
    }
  }

  private resolveUrl(input: string | Buffer): string {
    if (Buffer.isBuffer(input)) {
      throw new Error(
        "ImageAdapter with Azure/Landing.AI requires a URL. " +
          "Store the file first and pass the URL.",
      );
    }
    return input;
  }
}
