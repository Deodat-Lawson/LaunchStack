import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtractionJob } from "@launchstack/orchestration";
import type { LoggerPort } from "@launchstack/runtime";

const mocks = vi.hoisted(() => ({
    cleanup: undefined as
        | undefined
        | ((input: {
              sourceId: number;
              ocrJobId: string;
              userId: string;
              traceId: string;
          }) => Promise<void>),
    extract: vi.fn(),
    index: vi.fn(),
    transaction: vi.fn(),
    deleteDocumentCore: vi.fn(),
    deleteJob: vi.fn(),
    scope: vi.fn(),
}));
vi.mock("@launchstack/indexing", () => ({
    DocIngestionPipeline: class {
        constructor(_logger: unknown, cleanup: typeof mocks.cleanup) {
            mocks.cleanup = cleanup;
        }
        extract = mocks.extract;
        index = mocks.index;
    },
}));
vi.mock("~/server/db", () => ({ db: { transaction: mocks.transaction } }));
vi.mock("~/server/services/document-delete", () => ({
    deleteDocumentCore: mocks.deleteDocumentCore,
}));
vi.mock("~/server/ai-usage/uploader", () => ({
    uploaderOfVersion: vi.fn(),
    uploaderOrNull: vi.fn().mockResolvedValue("uploader"),
}));
vi.mock("~/server/workspace-models/scope", () => ({ withWorkspaceChatModels: mocks.scope }));
import { createIngestionPipelinePort } from "../src/ports/ingestion";

const tx = { delete: vi.fn(() => ({ where: mocks.deleteJob })) };
const logger: LoggerPort = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
const cleanupInput = { sourceId: 7, ocrJobId: "zip-job", userId: "user1", traceId: "trace-zip" };
beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(async callback => callback(tx));
    mocks.deleteDocumentCore.mockResolvedValue(undefined);
    mocks.deleteJob.mockResolvedValue(undefined);
    mocks.scope.mockImplementation(async (_company, _usage, body) => body());
});
describe("worker ingestion archive cleanup", () => {
    it("plans/removes the document before cleaning the OCR job in the same transaction", async () => {
        createIngestionPipelinePort(logger);
        await mocks.cleanup!(cleanupInput);
        expect(mocks.transaction).toHaveBeenCalledOnce();
        expect(mocks.deleteDocumentCore).toHaveBeenCalledWith(tx, 7, {
            requestedBy: "user1",
            reason: "archive_expanded",
            traceId: "trace-zip",
            rememberConnectorDeletion: false,
        });
        expect(mocks.deleteJob).toHaveBeenCalledOnce();
        expect(mocks.deleteDocumentCore.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.deleteJob.mock.invocationCallOrder[0]!
        );
    });
    it("preserves the OCR job when deletion planning fails", async () => {
        createIngestionPipelinePort(logger);
        mocks.deleteDocumentCore.mockRejectedValueOnce(new Error("outbox unavailable"));
        await expect(mocks.cleanup!(cleanupInput)).rejects.toThrow("outbox unavailable");
        expect(mocks.deleteJob).not.toHaveBeenCalled();
    });
    it("keeps extraction inside the uploader's unmetered workspace model scope", async () => {
        const port = createIngestionPipelinePort(logger);
        const job = { companyId: 42, actorId: "user1" } as ExtractionJob;
        mocks.extract.mockResolvedValue({ provider: "INGESTION" });
        await port.extract(job);
        expect(mocks.scope).toHaveBeenCalledWith(
            42,
            { feature: "ingestion", userId: "user1", enforce: false },
            expect.any(Function)
        );
        expect(mocks.extract).toHaveBeenCalledWith(job);
    });
});
