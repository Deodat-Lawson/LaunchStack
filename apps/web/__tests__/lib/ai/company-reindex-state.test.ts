/**
 * Unit tests for the reindex state machine. The DB is mocked; these cover
 * the branching logic in resolve / begin / complete / fail.
 */

jest.mock("~/server/db", () => ({
  db: {
    select: jest.fn(),
    update: jest.fn(),
  },
}));

jest.mock("~/server/db/schema", () => ({
  company: {
    id: "company.id",
    activeEmbeddingIndexKey: "company.active_embedding_index_key",
    pendingEmbeddingIndexKey: "company.pending_embedding_index_key",
    reindexStatus: "company.reindex_status",
    reindexJobId: "company.reindex_job_id",
    reindexStartedAt: "company.reindex_started_at",
    reindexCompletedAt: "company.reindex_completed_at",
    reindexError: "company.reindex_error",
    embeddingIndexKey: "company.embedding_index_key",
  },
}));

import { db } from "~/server/db";
import {
  beginReindex,
  completeReindex,
  failReindex,
  getCompanyReindexState,
  resolveIngestIndexKey,
  resolveQueryIndexKey,
} from "~/lib/ai/company-reindex-state";

const selectMock = db.select as jest.Mock;
const updateMock = db.update as jest.Mock;

function chainableSelect(result: unknown) {
  const chain = {
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    limit: jest.fn().mockResolvedValue(result),
  };
  selectMock.mockReturnValueOnce(chain);
  return chain;
}

function chainableUpdate(resultRows: unknown[] = [{ status: "REINDEXING" }]) {
  const chain = {
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    returning: jest.fn().mockResolvedValue(resultRows),
  };
  updateMock.mockReturnValueOnce(chain);
  return chain;
}

describe("company-reindex-state", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("getCompanyReindexState", () => {
    it("returns null when no row exists", async () => {
      chainableSelect([]);
      const state = await getCompanyReindexState(99);
      expect(state).toBeNull();
    });

    it("prefers active over legacy index key", async () => {
      chainableSelect([
        {
          id: 7,
          active: "ollama-default",
          pending: null,
          status: "STABLE",
          jobId: null,
          startedAt: null,
          completedAt: null,
          error: null,
          legacy: "legacy-openai-1536",
        },
      ]);
      const state = await getCompanyReindexState(7);
      expect(state?.activeIndexKey).toBe("ollama-default");
    });

    it("falls back to legacy column when active is null (pre-0012 rows)", async () => {
      chainableSelect([
        {
          id: 7,
          active: null,
          pending: null,
          status: "STABLE",
          jobId: null,
          startedAt: null,
          completedAt: null,
          error: null,
          legacy: "legacy-openai-1536",
        },
      ]);
      const state = await getCompanyReindexState(7);
      expect(state?.activeIndexKey).toBe("legacy-openai-1536");
    });
  });

  describe("resolveIngestIndexKey", () => {
    it("returns pending during REINDEXING so new docs embed into the target", async () => {
      chainableSelect([
        {
          id: 1,
          active: "ollama-default",
          pending: "huggingface-default",
          status: "REINDEXING",
          jobId: "job-xyz",
          startedAt: new Date(),
          completedAt: null,
          error: null,
          legacy: null,
        },
      ]);
      const key = await resolveIngestIndexKey(1);
      expect(key).toBe("huggingface-default");
    });

    it("returns active when stable", async () => {
      chainableSelect([
        {
          id: 1,
          active: "ollama-default",
          pending: null,
          status: "STABLE",
          jobId: null,
          startedAt: null,
          completedAt: null,
          error: null,
          legacy: null,
        },
      ]);
      const key = await resolveIngestIndexKey(1);
      expect(key).toBe("ollama-default");
    });
  });

  describe("resolveQueryIndexKey", () => {
    it("always returns active, never pending", async () => {
      chainableSelect([
        {
          id: 1,
          active: "ollama-default",
          pending: "huggingface-default",
          status: "REINDEXING",
          jobId: "job",
          startedAt: new Date(),
          completedAt: null,
          error: null,
          legacy: null,
        },
      ]);
      const key = await resolveQueryIndexKey(1);
      expect(key).toBe("ollama-default");
    });
  });

  describe("beginReindex", () => {
    it("returns true when the update affects a row", async () => {
      chainableUpdate([{ status: "REINDEXING" }]);
      const ok = await beginReindex({
        companyId: 42,
        pendingIndexKey: "ollama-default",
        jobId: "job-1",
      });
      expect(ok).toBe(true);
    });

    it("returns false when no row was updated", async () => {
      chainableUpdate([]);
      const ok = await beginReindex({
        companyId: 42,
        pendingIndexKey: "ollama-default",
        jobId: "job-1",
      });
      expect(ok).toBe(false);
    });
  });

  describe("completeReindex", () => {
    it("throws when pending is null", async () => {
      chainableSelect([{ pending: null }]);
      await expect(completeReindex(1)).rejects.toThrow(/no pending/i);
    });

    it("writes active ← pending when pending is set", async () => {
      chainableSelect([{ pending: "huggingface-default" }]);
      const updateChain = chainableUpdate([]);
      await completeReindex(1);
      expect(updateChain.set).toHaveBeenCalledWith(
        expect.objectContaining({
          activeEmbeddingIndexKey: "huggingface-default",
          embeddingIndexKey: "huggingface-default",
          pendingEmbeddingIndexKey: null,
          reindexStatus: "STABLE",
        }),
      );
    });
  });

  describe("failReindex", () => {
    it("truncates long error messages", async () => {
      const chain = chainableUpdate([]);
      const longMessage = "x".repeat(5000);
      await failReindex(1, longMessage);
      const call = chain.set.mock.calls[0][0] as { reindexError: string };
      expect(call.reindexError.length).toBe(2000);
    });
  });
});
