/**
 * The worker's event dispatch table (ADR-003).
 *
 * One claimed outbox event → one handler → zero or more follow-up events.
 * Handlers are idempotent because the ports they call are (content-hash
 * dedup, upserts, deterministic event ids), so redelivery and operator
 * replay converge instead of duplicating work.
 */
import {
    eventIds,
    PROTOCOL_VERSION,
    type EvidenceVersionExtractedEvent,
    type EvidenceVersionIndexedEvent,
    type CompanyStateProjectionRequestedEvent,
    type CompanyStateProjectedEvent,
    type PipelineEvent,
    type SourceVersionCreatedEvent,
    ocrProviderSchema,
} from "../pipeline-events";

import type {
    ClaimedEvent,
    ClockPort,
    CompanyProjectionPort,
    ExtractionJob,
    ExtractionPipelinePort,
    LoggerPort,
    NoteEmbeddingPort,
    NoteRehydrationPort,
} from "../ports";

export interface PipelineProcessorDeps {
    pipeline: ExtractionPipelinePort;
    projection: CompanyProjectionPort;
    noteRehydration: NoteRehydrationPort;
    noteEmbedding: NoteEmbeddingPort;
    clock: ClockPort;
    logger: LoggerPort;
}

export interface ProcessResult {
    followUps: PipelineEvent[];
}

function extractionJobFromEvent(event: SourceVersionCreatedEvent): ExtractionJob {
    const created = event.payload;
    return {
        companyId: event.companyId,
        sourceId: created.sourceId,
        sourceVersionId: created.sourceVersionId,
        ocrJobId: created.ocrJobId,
        documentUrl: created.documentUrl,
        documentName: created.documentName,
        category: created.category,
        actorId: created.userId,
        traceId: event.traceId,
        options: {
            forceOCR: created.options?.forceOCR,
            preferredProvider: created.options?.preferredProvider,
            embeddingIndexKey: created.options?.embeddingIndexKey,
            mimeType: created.mimeType,
            originalFilename: created.originalFilename,
            isWebsite: created.isWebsite,
            archiveIdentity: created.archiveIdentity,
            transcriptionMetadata: created.transcriptionMetadata,
        },
    };
}

export function createPipelineProcessor(deps: PipelineProcessorDeps) {
    const { pipeline, projection, noteRehydration, noteEmbedding, clock, logger } = deps;

    return {
        async process(claimed: ClaimedEvent): Promise<ProcessResult> {
            const { event } = claimed;
            const occurredAt = () => clock.now().toISOString();

            switch (event.eventType) {
                case "source.version.created": {
                    const outcome = await pipeline.extract(extractionJobFromEvent(event));
                    if (outcome.expandedArchive) {
                        logger.info(
                            { traceId: event.traceId, sourceId: event.payload.sourceId },
                            "archive expanded; per-entry sources carry their own events"
                        );
                        return { followUps: [] };
                    }
                    const provider = ocrProviderSchema.parse(outcome.provider);
                    const followUp: EvidenceVersionExtractedEvent = {
                        eventId: eventIds.evidenceVersionExtracted(event.payload.ocrJobId),
                        eventType: "evidence.version.extracted",
                        schemaVersion: PROTOCOL_VERSION,
                        occurredAt: occurredAt(),
                        traceId: event.traceId,
                        companyId: event.companyId,
                        payload: {
                            sourceId: event.payload.sourceId,
                            sourceVersionId: event.payload.sourceVersionId,
                            ocrJobId: event.payload.ocrJobId,
                            provider,
                            pageCount: outcome.pageCount,
                            confidence: outcome.confidence,
                            usedFastTextPath: outcome.usedFastTextPath,
                        },
                    };
                    return { followUps: [followUp] };
                }

                case "evidence.version.extracted": {
                    const job = await pipeline.index({
                        companyId: event.companyId,
                        sourceId: event.payload.sourceId,
                        sourceVersionId: event.payload.sourceVersionId,
                        ocrJobId: event.payload.ocrJobId,
                        traceId: event.traceId,
                    });
                    const followUp: EvidenceVersionIndexedEvent = {
                        eventId: eventIds.evidenceVersionIndexed(event.payload.ocrJobId),
                        eventType: "evidence.version.indexed",
                        schemaVersion: PROTOCOL_VERSION,
                        occurredAt: occurredAt(),
                        traceId: event.traceId,
                        companyId: event.companyId,
                        payload: {
                            sourceId: event.payload.sourceId,
                            sourceVersionId: event.payload.sourceVersionId,
                            ocrJobId: event.payload.ocrJobId,
                            embeddingIndexKey: job.embeddingIndexKey,
                            contextChunkCount: job.contextChunkCount,
                            retrievalChunkCount: job.retrievalChunkCount,
                            graphSynced: job.graphSynced,
                        },
                    };
                    return { followUps: [followUp] };
                }

                case "evidence.version.indexed": {
                    // DB-only post-index work runs here; the LLM-backed projection is
                    // requested as its OWN event so an LLM outage retries/dies on its
                    // own outbox row and can never block ingestion completion.
                    await noteRehydration.rehydrateForSourceVersion({
                        sourceId: event.payload.sourceId,
                        sourceVersionId: event.payload.sourceVersionId,
                        traceId: event.traceId,
                    });
                    const followUp: CompanyStateProjectionRequestedEvent = {
                        eventId: eventIds.companyStateProjectionRequested(
                            event.companyId,
                            event.payload.sourceVersionId
                        ),
                        eventType: "company.state.projection.requested",
                        schemaVersion: PROTOCOL_VERSION,
                        occurredAt: occurredAt(),
                        traceId: event.traceId,
                        companyId: event.companyId,
                        payload: {
                            projection: "company-metadata",
                            sourceId: event.payload.sourceId,
                            sourceVersionId: event.payload.sourceVersionId,
                        },
                    };
                    return { followUps: [followUp] };
                }

                case "company.state.projection.requested": {
                    await projection.projectCompanyState({
                        companyId: event.companyId,
                        sourceId: event.payload.sourceId,
                        traceId: event.traceId,
                    });
                    const followUp: CompanyStateProjectedEvent = {
                        eventId: eventIds.companyStateProjected(
                            event.companyId,
                            event.payload.sourceVersionId
                        ),
                        eventType: "company.state.projected",
                        schemaVersion: PROTOCOL_VERSION,
                        occurredAt: occurredAt(),
                        traceId: event.traceId,
                        companyId: event.companyId,
                        payload: {
                            projection: "company-metadata",
                            sourceId: event.payload.sourceId,
                            sourceVersionId: event.payload.sourceVersionId,
                        },
                    };
                    return { followUps: [followUp] };
                }

                case "company.state.projected": {
                    // Terminal audit event: consuming it (idempotently, trivially)
                    // gives operators a processed marker per projection in the outbox.
                    logger.info(
                        {
                            traceId: event.traceId,
                            companyId: event.companyId,
                            sourceVersionId: event.payload.sourceVersionId,
                        },
                        "company state projected"
                    );
                    return { followUps: [] };
                }

                case "note.embedding.requested": {
                    await noteEmbedding.embedNote({
                        noteId: event.payload.noteId,
                        traceId: event.traceId,
                    });
                    return { followUps: [] };
                }
            }
        },
    };
}

export type PipelineProcessor = ReturnType<typeof createPipelineProcessor>;
