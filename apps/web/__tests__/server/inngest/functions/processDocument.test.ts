/**
 * Unit tests for processDocument failure and archive lifecycle contracts.
 * Verifies failed runs are marked honestly and archive-derived work keeps
 * stable provenance and lifecycle dispatch inputs.
 */
import JSZip from "jszip";
import { uploadDocument } from "~/server/inngest/functions/processDocument";
import { handleProcessDocumentFailure } from "~/server/inngest/functions/processDocumentFailure";
import { createDocumentLifecycle } from "~/server/services/document-creation";
import { fetchFile } from "~/lib/storage";
import { putFile } from "~/server/storage/vercel-blob";
import { db } from "~/server/db";
import type { ProcessDocumentEventData } from "@launchstack/core/ocr/types";

jest.mock("~/server/inngest/client", () => ({
  inngest: {
    createFunction: jest.fn((_options, _trigger, handler) => ({ fn: handler })),
  },
}));

jest.mock("~/lib/tools", () => ({
  runDocIngestionTool: jest.fn(),
}));

jest.mock("~/lib/storage", () => ({
  fetchFile: jest.fn(),
}));

jest.mock("~/server/storage/vercel-blob", () => ({
  putFile: jest.fn(),
}));

jest.mock("~/server/services/document-creation", () => ({
  createDocumentLifecycle: jest.fn(),
}));

jest.mock("~/server/db", () => ({
  db: { update: jest.fn(), delete: jest.fn() },
}));
const mockDb = db as unknown as { update: jest.Mock; delete: jest.Mock };

const mockCreateDocumentLifecycle = createDocumentLifecycle as jest.Mock;
const mockFetchFile = fetchFile as jest.Mock;
const mockPutFile = putFile as jest.Mock;

function makeChain() {
  const where = jest.fn().mockResolvedValue(undefined);
  const set = jest.fn(() => ({ where }));
  return { set, where };
}

function makeEvent(data: Partial<ProcessDocumentEventData>) {
  return { data: { event: { data: data as ProcessDocumentEventData } } } as any;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("handleProcessDocumentFailure", () => {
  it("marks document.ocrProcessed as false (not true) on failure", async () => {
    const chain = makeChain();
    mockDb.update.mockReturnValueOnce({ set: chain.set });

    await handleProcessDocumentFailure({
      error: new Error("OCR provider timed out"),
      event: makeEvent({ documentId: 42, jobId: "job-1" }),
    });

    expect(chain.set).toHaveBeenCalledWith(
      expect.objectContaining({ ocrProcessed: false }),
    );
  });

  it("stores the real error message in document.ocrMetadata", async () => {
    const chain = makeChain();
    mockDb.update.mockReturnValueOnce({ set: chain.set });

    await handleProcessDocumentFailure({
      error: new Error("OCR provider timed out"),
      event: makeEvent({ documentId: 42, jobId: "job-1" }),
    });

    expect(chain.set).toHaveBeenCalledWith(
      expect.objectContaining({
        ocrMetadata: expect.objectContaining({
          error: "processing_failed",
          errorMessage: "OCR provider timed out",
        }),
      }),
    );
  });

  it("sets ocr_jobs.status to 'failed' instead of leaving it queued", async () => {
    const docChain = makeChain();
    const jobChain = makeChain();
    mockDb.update
      .mockReturnValueOnce({ set: docChain.set })
      .mockReturnValueOnce({ set: jobChain.set });

    await handleProcessDocumentFailure({
      error: new Error("boom"),
      event: makeEvent({ documentId: 42, jobId: "job-1" }),
    });

    expect(jobChain.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed" }),
    );
  });

  it("does not touch ocr_jobs if jobId is missing", async () => {
    const chain = makeChain();
    mockDb.update.mockReturnValueOnce({ set: chain.set });

    await handleProcessDocumentFailure({
      error: new Error("boom"),
      event: makeEvent({ documentId: 42 }),
    });

    expect(mockDb.update).toHaveBeenCalledTimes(1);
  });

  it("does not throw if the database update itself fails", async () => {
    mockDb.update.mockImplementationOnce(() => {
      throw new Error("connection lost");
    });

    await expect(
      handleProcessDocumentFailure({
        error: new Error("original failure"),
        event: makeEvent({ documentId: 42, jobId: "job-1" }),
      }),
    ).resolves.not.toThrow();
  });
});

describe("archive document lifecycle", () => {
  it("records normalized archive provenance and dispatch options for child and summary", async () => {
    const zip = new JSZip();
    zip.file("nested//docs/report.txt", "report");
    const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });

    mockFetchFile.mockResolvedValue({
      ok: true,
      arrayBuffer: async () => zipBuffer,
    });
    mockPutFile
      .mockResolvedValueOnce({ url: "https://blob.test/report.txt" })
      .mockResolvedValueOnce({ url: "https://blob.test/summary.md" });
    mockCreateDocumentLifecycle.mockResolvedValue({
      document: { id: 42 },
      version: { id: 43 },
      job: { id: "job-1" },
      documentId: 42,
      versionId: 43,
      jobId: "job-1",
      eventIds: ["event-1"],
    });
    mockDb.delete.mockReturnValue({
      where: jest.fn().mockResolvedValue(undefined),
    });

    const step = {
      run: jest.fn(
        async (_name: string, operation: () => Promise<unknown>) => operation(),
      ),
      sendEvent: jest.fn(),
    };
    const handler = (
      uploadDocument as unknown as {
        fn: (context: {
          event: { data: ProcessDocumentEventData };
          step: typeof step;
        }) => Promise<unknown>;
      }
    ).fn;

    const result = await handler({
      event: {
        data: {
          jobId: "archive-job",
          documentUrl: "https://blob.test/archive.zip",
          documentName: "archive.zip",
          originalFilename: "archive.zip",
          companyId: "7",
          userId: "user-1",
          documentId: 100,
          category: "documents",
          mimeType: "application/zip",
          options: { embeddingIndexKey: "company-index" },
        },
      },
      step,
    });

    expect(mockCreateDocumentLifecycle).toHaveBeenCalledTimes(2);
    expect(mockCreateDocumentLifecycle).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        creationKey: "archive:100:entry:nested/docs/report.txt",
        sourceArchiveName: "archive.zip",
        sourceArchiveEntry: "nested/docs/report.txt",
        processing: expect.objectContaining({
          originalFilename: "report.txt",
          embeddingIndexKey: "company-index",
        }),
      }),
    );
    expect(mockCreateDocumentLifecycle).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        creationKey: "archive:100:summary",
        sourceArchiveName: "archive.zip",
        sourceArchiveEntry: null,
        processing: expect.objectContaining({
          originalFilename: "_project_summary.md",
          embeddingIndexKey: "company-index",
        }),
      }),
    );
    expect(step.sendEvent).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({ success: true, extracted: 2 }),
    );
  });
});
