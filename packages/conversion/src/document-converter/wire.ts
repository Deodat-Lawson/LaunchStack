/**
 * HTTP contract for `services/document-converter` (ADR-004) — the
 * consolidation of the old ocr-router and ocr-worker.
 *
 * Design notes:
 * - The service reads its own validated configuration at startup. The old
 *   `/route` `env` map — request-scoped `process.env` mutation with a
 *   documented concurrency race, carrying live provider secrets in request
 *   bodies — is gone and MUST NOT return.
 * - Routing signals are named for what they are. The old fabricated
 *   `confidence` constants (0.99/0.95/0.5) are replaced by `signals`, which
 *   only ever contains real measurements; provider selection reasons are
 *   explicit strings.
 */
import { z } from "zod";

import { evidenceDocumentSchema } from "../evidence-document";
export { evidenceDocumentSchema, type EvidenceDocument } from "../evidence-document";
import { ocrProviderSchema } from "@launchstack/orchestration/pipeline-events";
import { PROTOCOL_VERSION } from "@launchstack/runtime/wire-version";

/** Uniform error envelope for all converter (and worker-facing) services. */
export const serviceErrorSchema = z.object({
    error: z.object({
        code: z.string().min(1),
        message: z.string().min(1),
        traceId: z.string().optional(),
    }),
});
export type ServiceError = z.infer<typeof serviceErrorSchema>;

export const routeRequestSchema = z.object({
    schemaVersion: z.literal(PROTOCOL_VERSION),
    /** Validated object reference (see ADR-004 §6) — never an arbitrary URL. */
    documentUrl: z.string().url(),
    mimeType: z.string().optional(),
    filename: z.string().optional(),
    forceOCR: z.boolean().optional(),
    preferredProvider: ocrProviderSchema.optional(),
    traceId: z.string().optional(),
});
export type RouteRequest = z.infer<typeof routeRequestSchema>;

/** Reasons a routing decision can give — enumerated so callers can log/branch honestly. */
export const routingReasonSchema = z.enum([
    "preferred-provider",
    "force-ocr",
    "interactive-form",
    "native-text-layer",
    "vision-complex",
    "vision-simple",
    "vision-unavailable",
    "not-a-pdf",
]);
export type RoutingReason = z.infer<typeof routingReasonSchema>;

export const routeResponseSchema = z.object({
    schemaVersion: z.literal(PROTOCOL_VERSION),
    provider: ocrProviderSchema,
    reason: routingReasonSchema,
    /** Page count read from the PDF when parseable; absent otherwise. */
    pageCount: z.number().int().positive().optional(),
    /** Real measurements only — no fabricated scores. */
    signals: z.object({
        /** Zero-shot/vision classifier label, when the vision path ran. */
        visionLabel: z.string().optional(),
        /** Vision classifier score in [0,1], when the vision path ran. */
        visionScore: z.number().min(0).max(1).optional(),
        /** True when the PDF has interactive AcroForm fields. */
        hasInteractiveForm: z.boolean().optional(),
        /** Characters of extractable text found in the sampled range. */
        textSampleChars: z.number().int().nonnegative().optional(),
    }),
});
export type RouteResponse = z.infer<typeof routeResponseSchema>;

export const renderPagesRequestSchema = z.object({
    schemaVersion: z.literal(PROTOCOL_VERSION),
    /** Base64-encoded PDF bytes. */
    buffer: z.string().min(1),
    /** 0-based page indices to render. */
    pageIndices: z.array(z.number().int().nonnegative()).min(1).max(20),
    traceId: z.string().optional(),
});
export type RenderPagesRequest = z.infer<typeof renderPagesRequestSchema>;

export const renderPagesResponseSchema = z.object({
    schemaVersion: z.literal(PROTOCOL_VERSION),
    /** Base64-encoded PNGs, aligned with the requested indices. */
    images: z.array(z.string()),
});
export type RenderPagesResponse = z.infer<typeof renderPagesResponseSchema>;

export const convertRequestSchema = z.object({
    schemaVersion: z.literal(PROTOCOL_VERSION),
    /** Validated object reference to the source bytes. */
    url: z.string().url(),
    filename: z.string().optional(),
    mimeType: z.string().optional(),
    traceId: z.string().optional(),
});
export type ConvertRequest = z.infer<typeof convertRequestSchema>;

/** `POST /convert` returns the typed evidence document. */
export const convertResponseSchema = evidenceDocumentSchema;
export type ConvertResponse = z.infer<typeof convertResponseSchema>;
