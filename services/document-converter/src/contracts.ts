/**
 * Local mirror of the FROZEN wire contracts in
 * `packages/protocol/schemas/v1/converter.*.schema.json` and
 * `evidence-document.schema.json` (semantics documented in
 * `packages/protocol/src/converter.ts` / `evidence-document.ts`).
 *
 * This service deliberately lives outside the pnpm workspace, so the shapes
 * are restated here. The vitest suite validates produced EvidenceDocuments
 * against the canonical JSON Schema with ajv, so drift fails the build.
 *
 * Per `packages/protocol/src/version.ts`, request parsing is non-strict:
 * unknown fields are stripped, not rejected, so ADDING an optional field
 * upstream stays backward compatible.
 */
import { z } from "zod";

import { OCR_PROVIDERS, type OcrProvider } from "./config.js";

export const PROTOCOL_VERSION = 1 as const;

export const ocrProviderSchema = z.enum(OCR_PROVIDERS);

// ── /route ─────────────────────────────────────────────────────────────

export const routeRequestSchema = z.object({
  schemaVersion: z.literal(PROTOCOL_VERSION),
  documentUrl: z.string().url(),
  mimeType: z.string().optional(),
  filename: z.string().optional(),
  forceOCR: z.boolean().optional(),
  preferredProvider: ocrProviderSchema.optional(),
  traceId: z.string().optional(),
});
export type RouteRequest = z.infer<typeof routeRequestSchema>;

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

/**
 * Real measurements only. The old fabricated confidence constants
 * (0.99 / 0.95 / 0.5) are gone — a caller that wants to branch does so on
 * `reason` and these signals, never on an invented score.
 */
export interface RouteSignals {
  visionLabel?: string;
  visionScore?: number;
  hasInteractiveForm?: boolean;
  textSampleChars?: number;
}

export interface RouteResponse {
  schemaVersion: typeof PROTOCOL_VERSION;
  provider: OcrProvider;
  reason: RoutingReason;
  pageCount?: number;
  signals: RouteSignals;
}

// ── /render-pages ──────────────────────────────────────────────────────

export const renderPagesRequestSchema = z.object({
  schemaVersion: z.literal(PROTOCOL_VERSION),
  /** Base64-encoded PDF bytes. */
  buffer: z.string().min(1),
  /** 0-based page indices to render. */
  pageIndices: z.array(z.number().int().nonnegative()).min(1).max(20),
  traceId: z.string().optional(),
});
export type RenderPagesRequest = z.infer<typeof renderPagesRequestSchema>;

export interface RenderPagesResponse {
  schemaVersion: typeof PROTOCOL_VERSION;
  /** Base64-encoded PNGs, aligned with the requested indices. */
  images: string[];
}

// ── /convert ───────────────────────────────────────────────────────────

export const convertRequestSchema = z.object({
  schemaVersion: z.literal(PROTOCOL_VERSION),
  url: z.string().url(),
  filename: z.string().optional(),
  mimeType: z.string().optional(),
  traceId: z.string().optional(),
});
export type ConvertRequest = z.infer<typeof convertRequestSchema>;

export type LayoutBlockType =
  | "heading"
  | "paragraph"
  | "list"
  | "table"
  | "figure"
  | "caption"
  | "code"
  | "header"
  | "footer"
  | "footnote"
  | "other";

export interface LayoutBlock {
  type: LayoutBlockType;
  text: string;
  bbox?: { x0: number; y0: number; x1: number; y1: number };
  /** Provider-reported only — this service never fabricates one. */
  confidence?: number;
}

export interface EvidencePage {
  /** 1-based page number — the citation anchor unit for paged sources. */
  pageNumber: number;
  text: string;
  blocks?: LayoutBlock[];
}

export interface EvidenceDocument {
  schemaVersion: typeof PROTOCOL_VERSION;
  provider: string;
  source: {
    filename?: string;
    mimeType?: string;
    pageCount?: number;
  };
  /**
   * Provider-reported document confidence. docling-serve reports none, so
   * documents produced here OMIT it — the old hardcoded 92.0 must not
   * reappear anywhere.
   */
  confidence?: number;
  pages: EvidencePage[];
  markdown?: string;
  warnings: string[];
}
