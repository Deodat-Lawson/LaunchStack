/**
 * Document complexity analysis and OCR routing.
 * Delegates heavy work (vision classification, PDF rendering) to the ocr-router sidecar.
 * Falls back to env-based heuristics if the sidecar is unavailable.
 */

import type { OCRProvider } from "~/lib/ocr/types";

export interface RoutingDecision {
  provider: OCRProvider;
  reason: string;
  confidence: number;
  pageCount: number;
  visionResult?: { label: string; score: number };
}

const OCR_ROUTER_URL = process.env.OCR_ROUTER_URL ?? "http://ocr-router:8002";

/**
 * Selects representative sample pages for analysis.
 */
export function selectSamplePages(totalPages: number): number[] {
  if (totalPages <= 3) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }

  const pages = new Set<number>();
  pages.add(1);
  pages.add(Math.ceil(totalPages / 2));
  pages.add(totalPages);

  if (totalPages > 20) {
    const randomPage = Math.floor(Math.random() * (totalPages - 2)) + 2;
    pages.add(randomPage);
  }

  return Array.from(pages)
    .sort((a, b) => a - b)
    .slice(0, 5);
}

/**
 * Renders PDF pages to PNG images via the ocr-router sidecar.
 * Used by processor.ts for VLM enrichment.
 */
export async function renderPagesToImages(
  buffer: ArrayBuffer,
  pageIndices: number[]
): Promise<Uint8Array[]> {
  try {
    const response = await fetch(`${OCR_ROUTER_URL}/render-pages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        buffer: Buffer.from(buffer).toString("base64"),
        pageIndices,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.warn(`OCR router render-pages failed (${response.status}): ${err}`);
      return [];
    }

    const { images } = (await response.json()) as { images: string[] };
    return images.map((b64) => new Uint8Array(Buffer.from(b64, "base64")));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`OCR router unreachable for render-pages: ${message}`);
    return [];
  }
}

function getDefaultOCRProvider(): OCRProvider {
  const configured = process.env.OCR_DEFAULT_PROVIDER?.toUpperCase();
  if (configured === "MARKER" || configured === "DOCLING") {
    if (process.env.OCR_WORKER_URL) return configured as OCRProvider;
  }
  if (process.env.OCR_WORKER_URL) return "DOCLING";
  if (process.env.AZURE_DOC_INTELLIGENCE_KEY && process.env.AZURE_DOC_INTELLIGENCE_ENDPOINT) return "AZURE";
  if (process.env.LANDING_AI_API_KEY) return "LANDING_AI";
  if (process.env.DATALAB_API_KEY) return "DATALAB";
  return "DOCLING";
}

/**
 * Determines the optimal OCR provider for a document by delegating to the
 * ocr-router sidecar (which runs the vision model and PDF analysis).
 * Falls back to a simple env-based default if the sidecar is unavailable.
 */
export async function determineDocumentRouting(
  documentUrl: string
): Promise<RoutingDecision> {
  try {
    const response = await fetch(`${OCR_ROUTER_URL}/route`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        documentUrl,
        env: {
          OCR_DEFAULT_PROVIDER: process.env.OCR_DEFAULT_PROVIDER ?? "",
          OCR_WORKER_URL: process.env.OCR_WORKER_URL ?? "",
          AZURE_DOC_INTELLIGENCE_KEY: process.env.AZURE_DOC_INTELLIGENCE_KEY ?? "",
          AZURE_DOC_INTELLIGENCE_ENDPOINT: process.env.AZURE_DOC_INTELLIGENCE_ENDPOINT ?? "",
          LANDING_AI_API_KEY: process.env.LANDING_AI_API_KEY ?? "",
          DATALAB_API_KEY: process.env.DATALAB_API_KEY ?? "",
          // AI vision keys — ocr-router uses OpenAI-compatible vision for classification
          OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "",
          AI_API_KEY: process.env.AI_API_KEY ?? "",
          AI_BASE_URL: process.env.AI_BASE_URL ?? "",
          OCR_VISION_MODEL: process.env.OCR_VISION_MODEL ?? "",
        },
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.warn(`OCR router /route failed (${response.status}): ${err}`);
      throw new Error(`OCR router returned ${response.status}`);
    }

    return (await response.json()) as RoutingDecision;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`OCR router unavailable, using default provider: ${message}`);

    const fallback = getDefaultOCRProvider();
    return {
      provider: fallback,
      reason: `OCR router unavailable, defaulting to ${fallback}`,
      confidence: 0.5,
      pageCount: 0,
    };
  }
}
