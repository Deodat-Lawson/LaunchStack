/**
 * `EvidenceDocument` — the typed output of `services/document-converter`
 * (ADR-004). One conversion of one source version produces exactly one of
 * these; the worker persists it as immutable evidence and every citation
 * anchor ultimately points back into it.
 *
 * Confidence fields are provider-reported or absent; the converter never
 * fabricates them (ADR-005 §3).
 */
import { z } from "zod";

import { PROTOCOL_VERSION } from "./version";

/** Normalized [0,1] page-relative bounding box, when the provider has layout. */
export const boundingBoxSchema = z.object({
    x0: z.number().min(0).max(1),
    y0: z.number().min(0).max(1),
    x1: z.number().min(0).max(1),
    y1: z.number().min(0).max(1),
});
export type BoundingBox = z.infer<typeof boundingBoxSchema>;

export const layoutBlockTypeSchema = z.enum([
    "heading",
    "paragraph",
    "list",
    "table",
    "figure",
    "caption",
    "code",
    "header",
    "footer",
    "footnote",
    "other",
]);
export type LayoutBlockType = z.infer<typeof layoutBlockTypeSchema>;

/** One structural block on a page, when the provider supplies layout. */
export const layoutBlockSchema = z.object({
    type: layoutBlockTypeSchema,
    text: z.string(),
    bbox: boundingBoxSchema.optional(),
    /** Provider-reported block-level confidence in [0,1], when available. */
    confidence: z.number().min(0).max(1).optional(),
});
export type LayoutBlock = z.infer<typeof layoutBlockSchema>;

export const evidencePageSchema = z.object({
    /** 1-based page number — the citation anchor unit for paged sources. */
    pageNumber: z.number().int().positive(),
    /** Full plain text of the page in reading order. */
    text: z.string(),
    /** Layout blocks in reading order, when the provider supplies them. */
    blocks: z.array(layoutBlockSchema).optional(),
});
export type EvidencePage = z.infer<typeof evidencePageSchema>;

export const evidenceDocumentSchema = z.object({
    schemaVersion: z.literal(PROTOCOL_VERSION),
    /** Parser that produced this document (e.g. "docling", "native-pdf"). */
    provider: z.string().min(1),
    source: z.object({
        filename: z.string().optional(),
        mimeType: z.string().optional(),
        /** Total pages in the source, when the format has pages. */
        pageCount: z.number().int().nonnegative().optional(),
    }),
    /** Provider-reported document-level extraction confidence, when available. */
    confidence: z.number().min(0).max(1).optional(),
    pages: z.array(evidencePageSchema),
    /** Whole-document markdown, when the provider produces it (docling does). */
    markdown: z.string().optional(),
    /** Non-fatal problems encountered during conversion. */
    warnings: z.array(z.string()),
});
export type EvidenceDocument = z.infer<typeof evidenceDocumentSchema>;
