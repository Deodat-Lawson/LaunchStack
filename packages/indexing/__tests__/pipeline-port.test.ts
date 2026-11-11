import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtractionJob } from "@launchstack/orchestration";
import type { LoggerPort } from "@launchstack/runtime";

const mocks = vi.hoisted(() => ({
    expandArchive: vi.fn(),
    download: vi.fn(),
    runExtractionStage: vi.fn(),
    sourceRows: vi.fn(),
}));
vi.mock("@launchstack/conversion", () => ({
    expandArchive: mocks.expandArchive,
    isZipFile: (mime: string) => mime === "application/zip",
    isTextFastPathFile: () => false,
}));
vi.mock("@launchstack/runtime", () => ({ getStoragePort: () => ({ download: mocks.download }) }));
vi.mock("@launchstack/store/client", () => ({
    getDb: () => ({
        select: () => ({
            from: () => ({ where: () => ({ limit: mocks.sourceRows }) }),
        }),
    }),
}));
vi.mock("../src/doc-ingestion", () => ({
    runExtractionStage: mocks.runExtractionStage,
    runIndexingStage: vi.fn(),
}));
import { DocIngestionPipeline } from "../src/pipeline-port";

const job: ExtractionJob = {
    companyId: 42,
    sourceId: 7,
    sourceVersionId: 8,
    ocrJobId: "zip-job",
    documentUrl: "/api/files/10",
    documentName: "archive.zip",
    category: "Docs",
    actorId: "user1",
    traceId: "trace-archive",
    options: { mimeType: "application/zip" },
};
const logger: LoggerPort = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
beforeEach(() => {
    vi.clearAllMocks();
    mocks.expandArchive.mockResolvedValue({ extracted: 2, stats: { indexed: 1 } });
    mocks.sourceRows.mockResolvedValue([{ id: 7 }]);
});
describe("archive cleanup injection", () => {
    it("passes the host cleanup callback and job trace through archive expansion", async () => {
        const cleanupArchive = vi.fn();
        const pipeline = new DocIngestionPipeline(logger, cleanupArchive);
        expect(await pipeline.extract(job)).toMatchObject({ expandedArchive: true });
        const input = mocks.expandArchive.mock.calls[0]![0];
        expect(input).toMatchObject({
            sourceId: 7,
            ocrJobId: "zip-job",
            traceId: "trace-archive",
            userId: "user1",
            cleanupArchive,
        });
        await input.cleanupArchive({
            sourceId: 7,
            ocrJobId: "zip-job",
            userId: "user1",
            traceId: "trace-archive",
        });
        expect(cleanupArchive).toHaveBeenCalledOnce();
        expect(mocks.runExtractionStage).not.toHaveBeenCalled();
    });
    it("lets transactional cleanup failures propagate for outbox retry", async () => {
        const cleanupArchive = vi.fn().mockRejectedValue(new Error("plan unavailable"));
        mocks.expandArchive.mockImplementationOnce(async input => {
            await input.cleanupArchive(input);
        });
        await expect(new DocIngestionPipeline(logger, cleanupArchive).extract(job)).rejects.toThrow(
            "plan unavailable"
        );
    });
    it("converges a missing archive source replay without fetching deleted bytes", async () => {
        mocks.sourceRows.mockResolvedValueOnce([]);
        const cleanupArchive = vi.fn();
        const result = await new DocIngestionPipeline(logger, cleanupArchive).extract(job);
        // This outcome makes source.version.created finish without indexing follow-ups.
        expect(result).toEqual({
            provider: "INGESTION",
            usedFastTextPath: false,
            expandedArchive: true,
        });
        expect(logger.info).toHaveBeenCalledWith(
            { sourceId: 7, traceId: "trace-archive" },
            "archive source no longer exists; skipping replay"
        );
        expect(mocks.expandArchive).not.toHaveBeenCalled();
        expect(mocks.download).not.toHaveBeenCalled();
        expect(cleanupArchive).not.toHaveBeenCalled();
        expect(mocks.runExtractionStage).not.toHaveBeenCalled();
    });
    it("does not swallow archive storage failures while its source still exists", async () => {
        mocks.expandArchive.mockRejectedValueOnce(new Error("storage download failed"));
        await expect(new DocIngestionPipeline(logger, vi.fn()).extract(job)).rejects.toThrow(
            "storage download failed"
        );
    });
    it("does not treat unrelated extraction failures as missing archive replays", async () => {
        mocks.runExtractionStage.mockRejectedValueOnce(new Error("OCR unavailable"));
        await expect(
            new DocIngestionPipeline(logger, vi.fn()).extract({
                ...job,
                documentName: "report.pdf",
                options: { mimeType: "application/pdf" },
            })
        ).rejects.toThrow("OCR unavailable");
        expect(mocks.sourceRows).not.toHaveBeenCalled();
    });
});
