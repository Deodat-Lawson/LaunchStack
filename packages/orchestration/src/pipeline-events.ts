/**
 * Pipeline event contracts (ADR-003).
 *
 * Every durable hand-off in the ingestion pipeline is one of these events,
 * written to the `pdr_ai_v2_event_outbox` table in the same transaction as
 * the state change it announces, and consumed by `apps/worker`. Consumers
 * must be idempotent: `eventId` is a deterministic key derived from the
 * state change (e.g. `source.version.created:{ocrJobId}`), so redelivery
 * and replay converge.
 */
import { z } from "zod";

import { PROTOCOL_VERSION } from "@launchstack/runtime/wire-version";
export { PROTOCOL_VERSION };

/**
 * OCR/parse providers accepted by the pipeline. `MARKER` is intentionally
 * absent: it never had a real implementation (ADR-004). Historical
 * `dispatchOptions` rows containing `MARKER` are mapped to `DOCLING` with a
 * logged warning at the adapter boundary.
 */
export const ocrProviderSchema = z.enum([
    "AZURE",
    "LANDING_AI",
    "NATIVE_PDF",
    "DATALAB",
    "INGESTION",
    "DOCLING",
]);
export type OcrProvider = z.infer<typeof ocrProviderSchema>;

/**
 * Normalize a free-form provider string to the pipeline's OcrProvider
 * vocabulary. "MARKER" is deliberately absent — ADR-004 removed it as an
 * alias that never had an implementation.
 */
export function parseOcrProvider(provider?: string): OcrProvider | undefined {
    if (!provider) return undefined;
    const normalized = provider.toUpperCase();
    const parsed = ocrProviderSchema.safeParse(normalized);
    return parsed.success ? parsed.data : undefined;
}

export const EVENT_TYPES = [
    "source.version.created",
    "evidence.version.extracted",
    "evidence.version.indexed",
    "company.state.projection.requested",
    "company.state.projected",
    "note.embedding.requested",
] as const;

export const eventTypeSchema = z.enum(EVENT_TYPES);
export type EventType = z.infer<typeof eventTypeSchema>;

/**
 * Envelope shared by every event. `companyId` is the workspace scope the
 * event belongs to — translated from product identity at the application
 * boundary; nothing below that boundary sees users, sessions or billing.
 */
export const eventEnvelopeBaseSchema = z.object({
    /** Deterministic idempotency key, unique across the outbox. */
    eventId: z.string().min(1).max(160),
    eventType: eventTypeSchema,
    schemaVersion: z.literal(PROTOCOL_VERSION),
    /** ISO-8601 timestamp of the state change that produced the event. */
    occurredAt: z.string().datetime({ offset: true }),
    /** Correlates one user command across web, worker and compute services. */
    traceId: z.string().min(1).max(128),
    companyId: z.number().int().positive(),
});

/**
 * Payload of `source.version.created` — a new immutable source version
 * exists and awaits extraction. Field names use the evidence vocabulary
 * (ADR-005); the adapter layer maps them onto document/documentVersions.
 */
export const sourceVersionCreatedPayloadSchema = z.object({
    /** `pdr_ai_v2_document.id` */
    sourceId: z.number().int().positive(),
    /** `pdr_ai_v2_document_versions.id` — the immutable version to extract. */
    sourceVersionId: z.number().int().positive(),
    /** `pdr_ai_v2_ocr_jobs.id` — extraction job created in the same tx. */
    ocrJobId: z.string().min(1),
    /** Storage reference of the original bytes (validated object ref). */
    documentUrl: z.string().min(1),
    documentName: z.string().min(1),
    category: z.string(),
    /** Product-side actor id recorded for provenance only. */
    userId: z.string().min(1),
    mimeType: z.string().optional(),
    originalFilename: z.string().optional(),
    isWebsite: z.boolean().optional(),
    /** Stable logical identity for archive-extracted files across retries. */
    archiveIdentity: z.string().optional(),
    /** Provenance for transcript documents produced from audio/video. */
    transcriptionMetadata: z.record(z.unknown()).optional(),
    options: z
        .object({
            forceOCR: z.boolean().optional(),
            preferredProvider: ocrProviderSchema.optional(),
            embeddingIndexKey: z.string().optional(),
        })
        .optional(),
});

/**
 * Payload of `evidence.version.extracted` — extraction finished; normalized
 * evidence (text, layout, page anchors) is persisted for the version.
 */
export const evidenceVersionExtractedPayloadSchema = z.object({
    sourceId: z.number().int().positive(),
    sourceVersionId: z.number().int().positive(),
    ocrJobId: z.string().min(1),
    provider: ocrProviderSchema,
    pageCount: z.number().int().nonnegative().optional(),
    /**
     * Provider-reported extraction confidence in [0,1]. Absent when the
     * provider does not report one — never fabricated (ADR-005).
     */
    confidence: z.number().min(0).max(1).optional(),
    usedFastTextPath: z.boolean(),
});

/**
 * Payload of `evidence.version.indexed` — chunking, embedding and storage
 * finished; the version is retrievable and citable.
 */
export const evidenceVersionIndexedPayloadSchema = z.object({
    sourceId: z.number().int().positive(),
    sourceVersionId: z.number().int().positive(),
    ocrJobId: z.string().min(1),
    embeddingIndexKey: z.string().optional(),
    contextChunkCount: z.number().int().nonnegative(),
    retrievalChunkCount: z.number().int().nonnegative(),
    graphSynced: z.boolean(),
});

/**
 * Payload of `company.state.projection.requested` — indexing finished and
 * derived company state should be refreshed. A separate request event so a
 * projection failure (e.g. LLM outage) retries and dies on its OWN outbox
 * row: it can never block ingestion completion or mark the extraction job
 * failed.
 */
export const companyStateProjectionRequestedPayloadSchema = z.object({
    projection: z.literal("company-metadata"),
    /** The source version whose indexing triggered this projection. */
    sourceId: z.number().int().positive(),
    sourceVersionId: z.number().int().positive(),
});

/**
 * Payload of `company.state.projected` — derived company state (company
 * metadata facts with provenance) WAS refreshed from indexed evidence.
 * Announcement only; its handler is a terminal audit consumer.
 */
export const companyStateProjectedPayloadSchema = z.object({
    projection: z.literal("company-metadata"),
    /** The source version whose indexing triggered this projection, if any. */
    sourceId: z.number().int().positive().optional(),
    sourceVersionId: z.number().int().positive().optional(),
});

/**
 * Payload of `note.embedding.requested` — a note needs (re-)embedding.
 * Replaces the fire-and-forget `void embedNote(...)` calls in web request
 * handlers (ADR-003 §unowned work).
 */
export const noteEmbeddingRequestedPayloadSchema = z.object({
    noteId: z.number().int().positive(),
    reason: z.enum(["created", "updated"]),
});

export const sourceVersionCreatedEventSchema = eventEnvelopeBaseSchema.extend({
    eventType: z.literal("source.version.created"),
    payload: sourceVersionCreatedPayloadSchema,
});
export const evidenceVersionExtractedEventSchema = eventEnvelopeBaseSchema.extend({
    eventType: z.literal("evidence.version.extracted"),
    payload: evidenceVersionExtractedPayloadSchema,
});
export const evidenceVersionIndexedEventSchema = eventEnvelopeBaseSchema.extend({
    eventType: z.literal("evidence.version.indexed"),
    payload: evidenceVersionIndexedPayloadSchema,
});
export const companyStateProjectionRequestedEventSchema = eventEnvelopeBaseSchema.extend({
    eventType: z.literal("company.state.projection.requested"),
    payload: companyStateProjectionRequestedPayloadSchema,
});
export const companyStateProjectedEventSchema = eventEnvelopeBaseSchema.extend({
    eventType: z.literal("company.state.projected"),
    payload: companyStateProjectedPayloadSchema,
});
export const noteEmbeddingRequestedEventSchema = eventEnvelopeBaseSchema.extend({
    eventType: z.literal("note.embedding.requested"),
    payload: noteEmbeddingRequestedPayloadSchema,
});

export const pipelineEventSchema = z.discriminatedUnion("eventType", [
    sourceVersionCreatedEventSchema,
    evidenceVersionExtractedEventSchema,
    evidenceVersionIndexedEventSchema,
    companyStateProjectionRequestedEventSchema,
    companyStateProjectedEventSchema,
    noteEmbeddingRequestedEventSchema,
]);

export type SourceVersionCreatedEvent = z.infer<typeof sourceVersionCreatedEventSchema>;
export type EvidenceVersionExtractedEvent = z.infer<typeof evidenceVersionExtractedEventSchema>;
export type EvidenceVersionIndexedEvent = z.infer<typeof evidenceVersionIndexedEventSchema>;
export type CompanyStateProjectionRequestedEvent = z.infer<
    typeof companyStateProjectionRequestedEventSchema
>;
export type CompanyStateProjectedEvent = z.infer<typeof companyStateProjectedEventSchema>;
export type NoteEmbeddingRequestedEvent = z.infer<typeof noteEmbeddingRequestedEventSchema>;
export type PipelineEvent = z.infer<typeof pipelineEventSchema>;

/**
 * Deterministic event ids. One state change → one id, so retries of the
 * producing transaction and replays of the consumer both converge.
 */
export const eventIds = {
    sourceVersionCreated: (ocrJobId: string) => `source.version.created:${ocrJobId}`,
    evidenceVersionExtracted: (ocrJobId: string) => `evidence.version.extracted:${ocrJobId}`,
    evidenceVersionIndexed: (ocrJobId: string) => `evidence.version.indexed:${ocrJobId}`,
    companyStateProjectionRequested: (companyId: number, sourceVersionId: number) =>
        `company.state.projection.requested:${companyId}:v${sourceVersionId}`,
    companyStateProjected: (companyId: number, sourceVersionId?: number) =>
        sourceVersionId === undefined
            ? `company.state.projected:${companyId}`
            : `company.state.projected:${companyId}:v${sourceVersionId}`,
    /**
     * Per-note id disambiguated by an edit fingerprint (the producer uses the
     * note's `updatedAt` epoch-ms). Each edit therefore gets its OWN
     * idempotent event: an edit that lands while a previous request is
     * mid-handler (`processing`) enqueues a new row instead of being absorbed
     * — and silently lost — by the in-flight one. The handler embeds the
     * CURRENT note content, so redelivery of any fingerprint converges; a
     * processed/dead row for the same fingerprint is revived to pending by
     * the producer's enqueue.
     */
    noteEmbeddingRequested: (noteId: number, fingerprint: string) =>
        `note.embedding.requested:${noteId}:${fingerprint}`,
} as const;
