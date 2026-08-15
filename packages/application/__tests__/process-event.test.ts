import { describe, expect, it, vi } from "vitest";

import { eventIds, PROTOCOL_VERSION } from "@launchstack/protocol";
import type { PipelineEvent } from "@launchstack/protocol";

import { createPipelineProcessor } from "../src/pipeline/process-event";
import type {
    ClaimedEvent,
    CompanyProjectionPort,
    ExtractionPipelinePort,
    NoteEmbeddingPort,
    NoteRehydrationPort,
} from "../src/ports";

const NOW = new Date("2026-08-09T12:00:00.000Z");

const silentLogger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
};

function deps(overrides?: {
    pipeline?: Partial<ExtractionPipelinePort>;
    projection?: CompanyProjectionPort;
    noteRehydration?: NoteRehydrationPort;
    noteEmbedding?: NoteEmbeddingPort;
}) {
    const pipeline: ExtractionPipelinePort = {
        extract: vi.fn(async () => ({
            provider: "DOCLING" as const,
            pageCount: 3,
            usedFastTextPath: false,
        })),
        index: vi.fn(async () => ({
            embeddingIndexKey: "openai-3-small",
            contextChunkCount: 4,
            retrievalChunkCount: 12,
            graphSynced: false,
        })),
        ...overrides?.pipeline,
    } as ExtractionPipelinePort;
    const projection: CompanyProjectionPort = overrides?.projection ?? {
        projectCompanyState: vi.fn(async () => ({ projected: true })),
    };
    const noteRehydration: NoteRehydrationPort = overrides?.noteRehydration ?? {
        rehydrateForSourceVersion: vi.fn(async () => {}),
    };
    const noteEmbedding: NoteEmbeddingPort = overrides?.noteEmbedding ?? {
        embedNote: vi.fn(async () => {}),
    };
    return {
        pipeline,
        projection,
        noteRehydration,
        noteEmbedding,
        clock: { now: () => NOW },
        logger: silentLogger,
    };
}

function claimed(event: PipelineEvent): ClaimedEvent {
    return { outboxId: 99, attemptCount: 0, event };
}

const createdEvent: PipelineEvent = {
    eventId: eventIds.sourceVersionCreated("job-1"),
    eventType: "source.version.created",
    schemaVersion: PROTOCOL_VERSION,
    occurredAt: NOW.toISOString(),
    traceId: "trace-1",
    companyId: 42,
    payload: {
        sourceId: 7,
        sourceVersionId: 9,
        ocrJobId: "job-1",
        documentUrl: "/api/files/1",
        documentName: "handbook.pdf",
        category: "General",
        userId: "user_a",
        mimeType: "application/pdf",
        options: { preferredProvider: "DOCLING", embeddingIndexKey: "k1" },
    },
};

describe("pipeline processor", () => {
    it("extracts on source.version.created and emits evidence.version.extracted", async () => {
        const d = deps();
        const processor = createPipelineProcessor(d);

        const { followUps } = await processor.process(claimed(createdEvent));

        expect(d.pipeline.extract).toHaveBeenCalledWith(
            expect.objectContaining({
                companyId: 42,
                sourceId: 7,
                sourceVersionId: 9,
                ocrJobId: "job-1",
                traceId: "trace-1",
                options: expect.objectContaining({
                    preferredProvider: "DOCLING",
                    embeddingIndexKey: "k1",
                    mimeType: "application/pdf",
                }),
            })
        );
        expect(followUps).toHaveLength(1);
        expect(followUps[0]).toMatchObject({
            eventId: eventIds.evidenceVersionExtracted("job-1"),
            eventType: "evidence.version.extracted",
            companyId: 42,
            payload: expect.objectContaining({ provider: "DOCLING", pageCount: 3 }),
        });
    });

    it("is replay-safe: reprocessing produces identical follow-up event ids", async () => {
        const processor = createPipelineProcessor(deps());
        const first = await processor.process(claimed(createdEvent));
        const second = await processor.process(claimed(createdEvent));
        expect(first.followUps.map(e => e.eventId)).toEqual(second.followUps.map(e => e.eventId));
    });

    it("indexes on evidence.version.extracted and emits evidence.version.indexed", async () => {
        const d = deps();
        const processor = createPipelineProcessor(d);
        const extracted: PipelineEvent = {
            eventId: eventIds.evidenceVersionExtracted("job-1"),
            eventType: "evidence.version.extracted",
            schemaVersion: PROTOCOL_VERSION,
            occurredAt: NOW.toISOString(),
            traceId: "trace-1",
            companyId: 42,
            payload: {
                sourceId: 7,
                sourceVersionId: 9,
                ocrJobId: "job-1",
                provider: "DOCLING",
                usedFastTextPath: false,
            },
        };

        const { followUps } = await processor.process(claimed(extracted));

        expect(d.pipeline.index).toHaveBeenCalledWith({
            companyId: 42,
            sourceId: 7,
            sourceVersionId: 9,
            ocrJobId: "job-1",
            traceId: "trace-1",
        });
        expect(followUps[0]).toMatchObject({
            eventId: eventIds.evidenceVersionIndexed("job-1"),
            eventType: "evidence.version.indexed",
            payload: expect.objectContaining({
                contextChunkCount: 4,
                retrievalChunkCount: 12,
            }),
        });
    });

    it("rehydrates notes and requests projection on indexed (LLM work deferred)", async () => {
        const d = deps();
        const processor = createPipelineProcessor(d);
        const indexed: PipelineEvent = {
            eventId: eventIds.evidenceVersionIndexed("job-1"),
            eventType: "evidence.version.indexed",
            schemaVersion: PROTOCOL_VERSION,
            occurredAt: NOW.toISOString(),
            traceId: "trace-1",
            companyId: 42,
            payload: {
                sourceId: 7,
                sourceVersionId: 9,
                ocrJobId: "job-1",
                contextChunkCount: 4,
                retrievalChunkCount: 12,
                graphSynced: false,
            },
        };

        const { followUps } = await processor.process(claimed(indexed));

        expect(d.noteRehydration.rehydrateForSourceVersion).toHaveBeenCalledWith({
            sourceId: 7,
            sourceVersionId: 9,
            traceId: "trace-1",
        });
        // The projection must NOT run inside the indexed handler — an LLM outage
        // would otherwise block ingestion completion.
        expect(d.projection.projectCompanyState).not.toHaveBeenCalled();
        expect(followUps[0]).toMatchObject({
            eventId: eventIds.companyStateProjectionRequested(42, 9),
            eventType: "company.state.projection.requested",
        });
    });

    it("projects state and announces company.state.projected on projection.requested", async () => {
        const d = deps();
        const processor = createPipelineProcessor(d);
        const requested: PipelineEvent = {
            eventId: eventIds.companyStateProjectionRequested(42, 9),
            eventType: "company.state.projection.requested",
            schemaVersion: PROTOCOL_VERSION,
            occurredAt: NOW.toISOString(),
            traceId: "trace-1",
            companyId: 42,
            payload: { projection: "company-metadata", sourceId: 7, sourceVersionId: 9 },
        };

        const { followUps } = await processor.process(claimed(requested));

        expect(d.projection.projectCompanyState).toHaveBeenCalledWith({
            companyId: 42,
            sourceId: 7,
            traceId: "trace-1",
        });
        expect(followUps[0]).toMatchObject({
            eventId: eventIds.companyStateProjected(42, 9),
            eventType: "company.state.projected",
        });
    });

    it("treats company.state.projected as a terminal audit event", async () => {
        const processor = createPipelineProcessor(deps());
        const projected: PipelineEvent = {
            eventId: eventIds.companyStateProjected(42, 9),
            eventType: "company.state.projected",
            schemaVersion: PROTOCOL_VERSION,
            occurredAt: NOW.toISOString(),
            traceId: "trace-1",
            companyId: 42,
            payload: { projection: "company-metadata", sourceVersionId: 9 },
        };
        const { followUps } = await processor.process(claimed(projected));
        expect(followUps).toEqual([]);
    });

    it("embeds notes on note.embedding.requested", async () => {
        const d = deps();
        const processor = createPipelineProcessor(d);
        const noteEvent: PipelineEvent = {
            eventId: eventIds.noteEmbeddingRequested(5, "1754680000000"),
            eventType: "note.embedding.requested",
            schemaVersion: PROTOCOL_VERSION,
            occurredAt: NOW.toISOString(),
            traceId: "trace-2",
            companyId: 42,
            payload: { noteId: 5, reason: "created" },
        };
        const { followUps } = await processor.process(claimed(noteEvent));
        expect(d.noteEmbedding.embedNote).toHaveBeenCalledWith({
            noteId: 5,
            traceId: "trace-2",
        });
        expect(followUps).toEqual([]);
    });
});
