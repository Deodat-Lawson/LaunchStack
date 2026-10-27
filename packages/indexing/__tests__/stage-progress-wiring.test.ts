/**
 * Where the doc-ingestion stages record progress: which rows the extraction
 * and indexing stages write (route only for routed PDFs, one embed write per
 * batch), that a throwing step is marked failed and the error rethrown
 * unchanged, and that a broken progress table never fails ingestion.
 *
 * The heavy collaborators (router, OCR, chunker, embeddings, storage) are
 * stubbed; the recorder is the real one over a fake database that keeps
 * pipeline state in memory and logs every ocr_processing_steps write.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DocumentChunk } from "@launchstack/conversion/ocr/types";
import { ocrJobs, ocrProcessingSteps } from "@launchstack/store/schema";

import { runExtractionStage, runIndexingStage } from "../src/doc-ingestion";
import type { DocIngestionToolInput } from "../src/doc-ingestion/types";

interface StepWrite {
    kind: "upsert" | "delete";
    values?: Record<string, unknown>;
}

const fake = vi.hoisted(() => ({
    db: undefined as unknown,
    ocrResult: {} as Record<string, unknown>,
    stepWrites: [] as unknown[],
    failStepWrites: false,
}));

const stubs = vi.hoisted(() => ({
    routeDocument: vi.fn(),
    normalizeDocument: vi.fn(),
    ingestToNormalized: vi.fn(),
    chunkPages: vi.fn(),
    createStructureTree: vi.fn(),
    storeBatch: vi.fn(),
    finalizeStorage: vi.fn(),
}));

vi.mock("@launchstack/store/client", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    getDb: () => fake.db,
}));

vi.mock("@launchstack/store/credits", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    creditsDebitSafe: async () => undefined,
}));

vi.mock("@launchstack/conversion/ocr/processor", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    routeDocument: stubs.routeDocument,
    normalizeDocument: stubs.normalizeDocument,
    chunkPages: stubs.chunkPages,
    createStructureTree: stubs.createStructureTree,
    storeBatch: stubs.storeBatch,
    finalizeStorage: stubs.finalizeStorage,
    withDbRetry: <T>(fn: () => Promise<T>) => fn(),
}));

vi.mock("@launchstack/conversion/ocr/chunker", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    prepareForEmbedding: (chunks: DocumentChunk[]) => chunks.map(c => c.content),
    mergeWithEmbeddings: (batch: DocumentChunk[]) => batch,
    getTotalChunkSize: (chunks: DocumentChunk[]) => ({
        textChunks: chunks.length,
        tableChunks: 0,
    }),
}));

vi.mock("@launchstack/conversion", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    ingestToNormalized: stubs.ingestToNormalized,
}));

vi.mock("@launchstack/llm/embeddings", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    getCompanyEmbeddingConfig: async () => null,
    resolveEmbeddingIndex: () => ({ indexKey: "test-index", model: "test-model" }),
    supportsShortVectorSearch: () => false,
    createEmbeddingModel: () => ({
        embedDocuments: async (texts: string[]) => texts.map(() => [0.1]),
        embedQuery: async () => [0.1],
    }),
}));

vi.mock("../src/knowledge-graph", () => ({
    isNeo4jConfigured: () => false,
    checkNeo4jHealth: async () => false,
    syncDocumentToNeo4j: async () => ({}),
}));

/** Pipeline state lives in memory; every progress-table write is logged. */
fake.db = {
    select: () => ({
        from: (table: unknown) => ({
            where: async () => (table === ocrJobs ? [{ ocrResult: fake.ocrResult }] : []),
        }),
    }),
    update: (table: unknown) => ({
        set: (values: Record<string, unknown>) => ({
            where: async () => {
                if (table === ocrJobs && "ocrResult" in values) {
                    fake.ocrResult = values.ocrResult as Record<string, unknown>;
                }
            },
        }),
    }),
    insert: (table: unknown) => ({
        values: (values: Record<string, unknown>) => ({
            onConflictDoUpdate: async () => {
                expect(table).toBe(ocrProcessingSteps);
                if (fake.failStepWrites) throw new Error('relation "ocr_processing_steps" is gone');
                fake.stepWrites.push({ kind: "upsert", values });
            },
        }),
    }),
    delete: (table: unknown) => ({
        where: async () => {
            expect(table).toBe(ocrProcessingSteps);
            if (fake.failStepWrites) throw new Error('relation "ocr_processing_steps" is gone');
            fake.stepWrites.push({ kind: "delete" });
        },
    }),
};

/** The progress writes as `stage:status` (or `reset`) — the bar's history. */
function timeline(): string[] {
    return (fake.stepWrites as StepWrite[]).map(w =>
        w.kind === "delete" ? "reset" : `${String(w.values!.stepType)}:${String(w.values!.status)}`
    );
}

function lastWrite(step: string): Record<string, unknown> {
    const rows = (fake.stepWrites as StepWrite[]).filter(
        w => w.kind === "upsert" && w.values!.stepType === step
    );
    return rows.at(-1)!.values!;
}

function makeChunks(count: number): DocumentChunk[] {
    return Array.from({ length: count }, (_, i) => ({
        id: `c${i}`,
        content: `chunk ${i}`,
        type: "text" as DocumentChunk["type"],
        metadata: { pageNumber: 1, chunkIndex: i, totalChunksInPage: count, isTable: false },
    }));
}

const PAGES = [
    { pageNumber: 1, textBlocks: ["one"], tables: [] },
    { pageNumber: 2, textBlocks: ["two"], tables: [] },
];

function input(overrides: Partial<DocIngestionToolInput> = {}): DocIngestionToolInput {
    return {
        jobId: "job-1",
        documentUrl: "https://files.test/report.pdf",
        documentName: "report.pdf",
        companyId: "7",
        userId: "user-1",
        documentId: 11,
        category: "General",
        versionId: 21,
        mimeType: "application/pdf",
        runtime: { updateJobStatus: false, markFailureInDb: false },
        ...overrides,
    };
}

function seedExtractedState(): void {
    fake.ocrResult = {
        pages: PAGES,
        extraction: {
            provider: "AZURE",
            pageCount: 2,
            processingTimeMs: 30,
            usedFastTextPath: false,
        },
    };
}

beforeEach(() => {
    fake.ocrResult = {};
    fake.stepWrites.length = 0;
    fake.failStepWrites = false;
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    stubs.routeDocument.mockReset().mockResolvedValue({
        isNativePDF: false,
        pageCount: 2,
        selectedProvider: "AZURE",
        reason: "scanned",
    });
    stubs.normalizeDocument.mockReset().mockResolvedValue({
        pages: PAGES,
        provider: "AZURE",
        processingTimeMs: 30,
    });
    stubs.ingestToNormalized.mockReset().mockResolvedValue({
        pages: PAGES,
        metadata: { provider: "INGESTION", processingTimeMs: 5 },
    });
    stubs.chunkPages.mockReset().mockResolvedValue(makeChunks(3));
    stubs.createStructureTree.mockReset().mockResolvedValue({ rootId: 1, sections: {} });
    stubs.storeBatch
        .mockReset()
        .mockImplementation(async (_doc: number, _structure: unknown, batch: DocumentChunk[]) =>
            batch.map((c, i) => ({ sectionId: i, content: c.content }))
        );
    stubs.finalizeStorage.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe("extraction stage progress", () => {
    it("records route then read for a PDF the router sees", async () => {
        const summary = await runExtractionStage(input());

        expect(summary.pageCount).toBe(2);
        expect(timeline()).toEqual([
            "reset",
            "route:in_progress",
            "route:completed",
            "read:in_progress",
            "read:completed",
        ]);
        expect(lastWrite("route")).toMatchObject({ id: "job-1:route", stepNumber: 1 });
        expect(lastWrite("read")).toMatchObject({
            id: "job-1:read",
            stepNumber: 2,
            output: { provider: "AZURE", pages: 2 },
        });
    });

    it("never writes a route row for a file that skips the router", async () => {
        await runExtractionStage(
            input({
                documentUrl: "https://files.test/notes.docx",
                documentName: "notes.docx",
                mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            })
        );

        expect(stubs.routeDocument).not.toHaveBeenCalled();
        expect(timeline()).toEqual(["reset", "read:in_progress", "read:completed"]);
        expect(lastWrite("read").output).toEqual({ provider: "INGESTION", pages: 2 });
    });

    it("marks read failed and rethrows the very same error", async () => {
        const ocrDown = new Error("OCR provider timed out");
        stubs.normalizeDocument.mockRejectedValue(ocrDown);

        await expect(runExtractionStage(input())).rejects.toBe(ocrDown);
        expect(timeline()).toEqual([
            "reset",
            "route:in_progress",
            "route:completed",
            "read:in_progress",
            "read:failed",
        ]);
        expect(lastWrite("read").errorMessage).toBe("OCR provider timed out");
    });

    it("records nothing for a host running durable Inngest steps (replays re-run it)", async () => {
        await runExtractionStage(
            input({
                runtime: { runStep: async <T>(_name: string, fn: () => Promise<T>) => fn() },
            })
        );
        expect(timeline()).toEqual([]);
    });

    it("keeps extracting when every progress write fails", async () => {
        fake.failStepWrites = true;
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

        const summary = await runExtractionStage(input());

        expect(summary).toMatchObject({ provider: "AZURE", pageCount: 2 });
        expect(fake.ocrResult.extraction).toMatchObject({ pageCount: 2 });
        expect(warn).toHaveBeenCalled();
    });
});

describe("indexing stage progress", () => {
    it("records chunk, embed (one write per batch) and finalize", async () => {
        seedExtractedState();
        stubs.chunkPages.mockResolvedValue(makeChunks(120));

        const counts = await runIndexingStage(input({ runtime: { sidecarBatchSize: 50 } }));

        expect(counts.contextChunkCount).toBe(120);
        expect(timeline()).toEqual([
            "reset",
            "chunk:in_progress",
            "chunk:completed",
            "embed:in_progress",
            "embed:in_progress",
            "embed:in_progress",
            "embed:in_progress",
            "embed:completed",
            "finalize:in_progress",
            "finalize:completed",
        ]);
        const embeds = (fake.stepWrites as StepWrite[])
            .filter(w => w.values?.stepType === "embed")
            .map(w => w.values!.output);
        expect(embeds).toEqual([
            { done: 0, total: 120 },
            { done: 50, total: 120 },
            { done: 100, total: 120 },
            { done: 120, total: 120 },
            { done: 120, total: 120 },
        ]);
        expect(lastWrite("chunk").output).toEqual({ chunks: 120 });
        expect(lastWrite("finalize")).toMatchObject({ id: "job-1:finalize", stepNumber: 5 });
    });

    it("records an empty document's embed as complete at 0 of 0", async () => {
        seedExtractedState();
        stubs.chunkPages.mockResolvedValue([]);

        await runIndexingStage(input());

        expect(stubs.createStructureTree).not.toHaveBeenCalled();
        expect(timeline()).toEqual([
            "reset",
            "chunk:in_progress",
            "chunk:completed",
            "embed:in_progress",
            "embed:completed",
            "finalize:in_progress",
            "finalize:completed",
        ]);
        expect(lastWrite("embed").output).toEqual({ done: 0, total: 0 });
    });

    it("marks the embed stage failed mid-way and rethrows unchanged", async () => {
        seedExtractedState();
        stubs.chunkPages.mockResolvedValue(makeChunks(120));
        const dbDown = new Error("deadlock detected");
        stubs.storeBatch
            .mockImplementationOnce(async (_d: number, _s: unknown, batch: DocumentChunk[]) =>
                batch.map((c, i) => ({ sectionId: i, content: c.content }))
            )
            .mockRejectedValueOnce(dbDown);

        await expect(runIndexingStage(input())).rejects.toBe(dbDown);

        expect(timeline().at(-1)).toBe("embed:failed");
        expect(lastWrite("embed")).toMatchObject({
            errorMessage: "deadlock detected",
            output: { done: 50, total: 120 },
        });
        expect(stubs.finalizeStorage).not.toHaveBeenCalled();
    });

    it("marks finalize failed when finalizing throws", async () => {
        seedExtractedState();
        const lost = new Error("connection lost");
        stubs.finalizeStorage.mockRejectedValue(lost);

        await expect(runIndexingStage(input())).rejects.toBe(lost);
        expect(timeline().slice(-2)).toEqual(["finalize:in_progress", "finalize:failed"]);
    });

    it("keeps indexing when every progress write fails", async () => {
        seedExtractedState();
        fake.failStepWrites = true;
        vi.spyOn(console, "warn").mockImplementation(() => undefined);

        const counts = await runIndexingStage(input());

        expect(counts.contextChunkCount).toBe(3);
        expect(stubs.finalizeStorage).toHaveBeenCalledTimes(1);
    });
});
