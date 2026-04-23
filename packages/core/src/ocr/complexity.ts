/**
 * Document complexity analysis and OCR routing.
 * Delegates heavy work (vision classification, PDF rendering) to the ocr-router sidecar.
 * Falls back to configured heuristics if the sidecar is unavailable.
 */

import { getOcrConfig } from "./config";
import type { OCRProvider } from "./types";

export interface RoutingDecision {
  provider: OCRProvider;
  reason: string;
  confidence: number;
  pageCount: number;
  visionResult?: { label: string; score: number };
}

function getOcrRouterUrl(): string {
  return getOcrConfig().routerUrl ?? "http://ocr-router:8002";
}

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
    const response = await fetch(`${getOcrRouterUrl()}/render-pages`, {
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
  const cfg = getOcrConfig();
  const configured = cfg.defaultProvider?.toUpperCase();
  if (configured === "MARKER" || configured === "DOCLING") {
    if (cfg.workerUrl) return configured as OCRProvider;
  }
  if (cfg.workerUrl) return "DOCLING";
  if (cfg.azure?.key && cfg.azure.endpoint) return "AZURE";
  if (cfg.landingAi?.apiKey) return "LANDING_AI";
  if (cfg.datalabApiKey) return "DATALAB";
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
  const cfg = getOcrConfig();
  try {
    const response = await fetch(`${getOcrRouterUrl()}/route`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        documentUrl,
        env: {
          OCR_DEFAULT_PROVIDER: cfg.defaultProvider ?? "",
          OCR_WORKER_URL: cfg.workerUrl ?? "",
          AZURE_DOC_INTELLIGENCE_KEY: cfg.azure?.key ?? "",
          AZURE_DOC_INTELLIGENCE_ENDPOINT: cfg.azure?.endpoint ?? "",
          LANDING_AI_API_KEY: cfg.landingAi?.apiKey ?? "",
          DATALAB_API_KEY: cfg.datalabApiKey ?? "",
          OPENAI_API_KEY: cfg.vision?.openaiApiKey ?? "",
          AI_API_KEY: cfg.vision?.aiApiKey ?? "",
          AI_BASE_URL: cfg.vision?.aiBaseUrl ?? "",
          OCR_VISION_MODEL: cfg.visionModel ?? "",
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
