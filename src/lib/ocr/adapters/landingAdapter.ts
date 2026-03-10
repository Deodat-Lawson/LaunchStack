/**
 * Landing.AI Adapter
 * Uses the ADE (Agentic Document Extraction) Parse API for OCR.
 * Supports complex documents with handwriting, messy layouts.
 * @see https://docs.landing.ai/ade/ade-quickstart
 * @see https://docs.landing.ai/api-reference/tools/ade-parse
 */

import type {
  OCRAdapter,
  OCRAdapterOptions,
  NormalizedDocument,
  PageContent,
  OCRProvider,
} from "../types";

/** ADE Parse API base URL (use api.va.eu-west-1.landing.ai for EU) */
const ADE_BASE_URL = "https://api.va.landing.ai";

interface ADEParseResponse {
  markdown: string;
  chunks: ADEParseChunk[];
  splits: ADEParseSplit[];
  metadata: {
    page_count: number;
    duration_ms: number;
  };
}

interface ADEParseChunk {
  markdown: string;
  type: string;
  id: string;
  grounding?: { page: number };
}

interface ADEParseSplit {
  class: string;
  identifier: string;
  pages: number[];
  markdown: string;
  chunks: string[];
}

/**
 * Landing.AI ADE Adapter
 * Uses the ADE Parse API with Authorization: Bearer per docs.landing.ai
 */
export class LandingAIAdapter implements OCRAdapter {
  private apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey ?? process.env.LANDING_AI_API_KEY ?? "";

    if (!this.apiKey) {
      console.warn(
        "Landing.AI API key not configured. Adapter will fail on use."
      );
    }
  }

  getProviderName(): OCRProvider {
    return "LANDING_AI";
  }

  async uploadDocument(
    documentUrl: string,
    _options?: OCRAdapterOptions
  ): Promise<NormalizedDocument> {
    if (!this.apiKey) {
      throw new Error(
        "Landing.AI API key not configured. Set LANDING_AI_API_KEY environment variable."
      );
    }

    const startTime = Date.now();

    // Fetch document server-side and send as binary. Landing AI's servers cannot reach
    // localhost or private URLs (e.g. /api/files/7), so we must upload the file ourselves.
    const docResponse = await fetch(documentUrl);
    if (!docResponse.ok) {
      throw new Error(
        `Failed to fetch document from ${documentUrl}: ${docResponse.status} ${docResponse.statusText}`
      );
    }
    const buffer = Buffer.from(await docResponse.arrayBuffer());
    const contentType = docResponse.headers.get("content-type") ?? "application/pdf";
    const rawName = documentUrl.split("/").pop()?.split("?")[0] ?? "";
    const ext = contentType.includes("pdf")
      ? "pdf"
      : contentType.includes("png")
        ? "png"
        : contentType.includes("jpeg") || contentType.includes("jpg")
          ? "jpg"
          : "pdf";
    const filename = rawName.includes(".") ? rawName : `document.${ext}`;

    const formData = new FormData();
    formData.append(
      "document",
      new Blob([buffer], { type: contentType }),
      filename
    );
    formData.append("model", "dpt-2-latest");
    formData.append("split", "page");

    const response = await fetch(`${ADE_BASE_URL}/v1/ade/parse`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Landing.AI parse failed: ${response.status} - ${errorText}`
      );
    }

    const data = (await response.json()) as ADEParseResponse;

    const pages = this.normalizeFromSplits(data);
    const processingTimeMs = Date.now() - startTime;

    return {
      pages,
      metadata: {
        totalPages: pages.length,
        provider: "LANDING_AI",
        processingTimeMs,
        confidenceScore: 95,
      },
    };
  }

  async extractPage(documentUrl: string, pageNumber: number): Promise<PageContent> {
    const document = await this.uploadDocument(documentUrl);

    const page = document.pages.find((p) => p.pageNumber === pageNumber);
    if (!page) {
      throw new Error(`Page ${pageNumber} not found in document`);
    }

    return page;
  }

  /**
   * Map ADE Parse splits (split=page) to PageContent[]
   */
  private normalizeFromSplits(data: ADEParseResponse): PageContent[] {
    if (data.splits && data.splits.length > 0) {
      return data.splits.map((split) => {
        const pageNum = split.pages[0] ?? 1;
        const text = split.markdown?.trim() ?? "";
        return {
          pageNumber: pageNum,
          textBlocks: text.length > 0 ? [text] : [],
          tables: [],
        };
      });
    }

    // Fallback: single page from full markdown
    const text = data.markdown?.trim() ?? "";
    return [
      {
        pageNumber: 1,
        textBlocks: text.length > 0 ? [text] : [],
        tables: [],
      },
    ];
  }
}

/**
 * Factory function to create Landing.AI adapter
 */
export function createLandingAIAdapter(apiKey?: string): LandingAIAdapter {
  return new LandingAIAdapter(apiKey);
}
