/**
 * Unit tests for the shared onFailure handler in processDocument.ts.
 * Verifies the failure-status contract: a failed pipeline run must be
 * honestly marked as failed, not silently treated as success.
 */
import { handleProcessDocumentFailure } from "~/server/inngest/functions/processDocumentFailure";
import { db } from "~/server/db";
import type { ProcessDocumentEventData } from "@launchstack/core/ocr/types";

jest.mock("~/server/db", () => ({
  db: { update: jest.fn() },
}));

const mockDb = db as unknown as { update: jest.Mock };

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