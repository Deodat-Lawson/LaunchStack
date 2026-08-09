/**
 * Document complexity analysis and OCR routing.
 *
 * Delegates the heavy work (vision classification, PDF analysis, page
 * rendering) to services/document-converter (ADR-004), which reads its own
 * provider/vision configuration at startup. The old ocr-router `env` map —
 * request-scoped process.env mutation carrying live provider secrets — is
 * gone and must not return.
 *
 * Responses carry an enumerated `reason` plus `signals` holding real
 * measurements only; there is no fabricated confidence anywhere on this path.
 * Falls back to a local default-provider decision when the converter is
 * unreachable.
 */

import { z } from "zod";

import { getOcrConfig } from "./config";
import type { OCRProvider } from "./types";

/** Wire schemaVersion of the frozen converter contract (packages/protocol). */
const SCHEMA_VERSION = 1;

/**
 * Enumerated routing reasons — mirrors `routingReasonSchema` in
 * packages/protocol/src/converter.ts (the frozen wire contract).
 */
export const ROUTING_REASONS = [
  "preferred-provider",
  "force-ocr",
  "interactive-form",
  "native-text-layer",
  "vision-complex",
  "vision-simple",
  "vision-unavailable",
  "not-a-pdf",
] as const;
export type RoutingReason = (typeof ROUTING_REASONS)[number];

/** Real measurements reported by the converter — never fabricated scores. */
export interface RoutingSignals {
  /** Zero-shot/vision classifier label, when the vision path ran. */
  visionLabel?: string;
  /** Vision classifier score in [0,1], when the vision path ran. */
  visionScore?: number;
  /** True when the PDF has interactive AcroForm fields. */
  hasInteractiveForm?: boolean;
  /** Characters of extractable text found in the sampled range. */
  textSampleChars?: number;
}

export interface RoutingDecision {
  provider: OCRProvider;
  reason: RoutingReason;
  /** 0 when the page count could not be measured. */
  pageCount: number;
  signals: RoutingSignals;
}

/** Local mirror of the frozen RouteResponse wire schema (validated on receipt). */
const routeResponseSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  provider: z.enum([
    "AZURE",
    "LANDING_AI",
    "NATIVE_PDF",
    "DATALAB",
    "INGESTION",
    "DOCLING",
  ]),
  reason: z.enum(ROUTING_REASONS),
  pageCount: z.number().int().positive().optional(),
  signals: z.object({
    visionLabel: z.string().optional(),
    visionScore: z.number().min(0).max(1).optional(),
    hasInteractiveForm: z.boolean().optional(),
    textSampleChars: z.number().int().nonnegative().optional(),
  }),
});

const renderPagesResponseSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  images: z.array(z.string()),
});

function getConverter(): { url: string; apiKey: string } | undefined {
  const converter = getOcrConfig().converter;
  if (!converter?.url) return undefined;
  return { url: converter.url.replace(/\/+$/, ""), apiKey: converter.apiKey };
}

/**
 * Selects representative sample pages (1-based) for analysis. The converter
 * runs its own sampling for routing; this stays exported for callers that
 * sample pages for VLM enrichment.
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
 * Renders PDF pages to PNG images via the document-converter.
 * Used by processor.ts for VLM enrichment.
 *
 * @param pageNumbers 1-based page numbers (the unit processor.ts works in);
 * the wire contract's `pageIndices` are 0-based, converted here.
 */
export async function renderPagesToImages(
  buffer: ArrayBuffer,
  pageNumbers: number[]
): Promise<Uint8Array[]> {
  if (pageNumbers.length === 0) return [];

  const converter = getConverter();
  if (!converter) {
    console.warn(
      "Document converter not configured (set DOCUMENT_CONVERTER_URL); skipping page rendering"
    );
    return [];
  }

  try {
    const response = await fetch(`${converter.url}/render-pages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": converter.apiKey,
      },
      body: JSON.stringify({
        schemaVersion: SCHEMA_VERSION,
        buffer: Buffer.from(buffer).toString("base64"),
        pageIndices: pageNumbers.map((pageNumber) => pageNumber - 1),
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.warn(
        `Document converter /render-pages failed (${response.status}): ${err}`
      );
      return [];
    }

    const { images } = renderPagesResponseSchema.parse(await response.json());
    return images.map((b64) => new Uint8Array(Buffer.from(b64, "base64")));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Document converter unreachable for /render-pages: ${message}`);
    return [];
  }
}

/**
 * Local fallback provider when the converter cannot be reached. Mirrors the
 * converter's own priority: operator pin > Docling (self-hosted via the
 * converter) > Azure > LandingAI > Datalab > Docling.
 */
function getDefaultOCRProvider(): OCRProvider {
  const cfg = getOcrConfig();
  if (cfg.defaultProvider) return cfg.defaultProvider;
  if (cfg.converter?.url) return "DOCLING";
  if (cfg.azure?.key && cfg.azure.endpoint) return "AZURE";
  if (cfg.landingAi?.apiKey) return "LANDING_AI";
  if (cfg.datalabApiKey) return "DATALAB";
  return "DOCLING";
}

/**
 * Fallback decision when the converter is unreachable: the configured default
 * provider, with the honest reason and NO fabricated confidence or signals.
 */
function localFallbackDecision(): RoutingDecision {
  return {
    provider: getDefaultOCRProvider(),
    reason: "vision-unavailable",
    pageCount: 0,
    signals: {},
  };
}

export interface RoutingRequestOptions {
  mimeType?: string;
  filename?: string;
  forceOCR?: boolean;
  preferredProvider?: OCRProvider;
  traceId?: string;
}

/**
 * Determines the optimal OCR provider for a document by delegating to
 * services/document-converter's POST /route (which runs the vision model and
 * PDF analysis against its own configuration). Falls back to a local
 * default-provider decision when the converter is unavailable.
 */
export async function determineDocumentRouting(
  documentUrl: string,
  options?: RoutingRequestOptions
): Promise<RoutingDecision> {
  const converter = getConverter();
  if (!converter) {
    console.warn(
      "Document converter not configured (set DOCUMENT_CONVERTER_URL); using default provider"
    );
    return localFallbackDecision();
  }

  try {
    const response = await fetch(`${converter.url}/route`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": converter.apiKey,
      },
      body: JSON.stringify({
        schemaVersion: SCHEMA_VERSION,
        documentUrl,
        ...(options?.mimeType ? { mimeType: options.mimeType } : {}),
        ...(options?.filename ? { filename: options.filename } : {}),
        ...(options?.forceOCR !== undefined ? { forceOCR: options.forceOCR } : {}),
        ...(options?.preferredProvider
          ? { preferredProvider: options.preferredProvider }
          : {}),
        ...(options?.traceId ? { traceId: options.traceId } : {}),
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.warn(
        `Document converter /route failed (${response.status}): ${err}`
      );
      throw new Error(`Document converter returned ${response.status}`);
    }

    const parsed = routeResponseSchema.parse(await response.json());
    return {
      provider: parsed.provider,
      reason: parsed.reason,
      pageCount: parsed.pageCount ?? 0,
      signals: parsed.signals,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `Document converter unavailable, using default provider: ${message}`
    );
    return localFallbackDecision();
  }
}
