import { eq } from "drizzle-orm";

import { db } from "~/server/db";
import { company } from "~/server/db/schema";

/**
 * Onyx-style SearchSettings lifecycle for per-company embedding model
 * configuration. Simpler than Onyx's 3-state PAST/PRESENT/FUTURE:
 *
 *   STABLE      — `active` is authoritative; `pending` is null.
 *   REINDEXING  — a background job is rewriting embeddings into `pending`;
 *                 queries still use `active`.
 *   FAILED      — a reindex crashed; `active` is still authoritative and
 *                 the error message is stored for operator review.
 *
 * Allowed transitions:
 *   STABLE      → REINDEXING  (user picked a new index key with docs present)
 *   REINDEXING  → STABLE      (job completed successfully; active ← pending)
 *   REINDEXING  → FAILED      (job errored out)
 *   FAILED      → REINDEXING  (operator retried)
 *   FAILED      → STABLE      (operator cleared; pending discarded)
 *
 * All mutations go through this module so the state machine stays tight.
 */

export type ReindexStatus = "STABLE" | "REINDEXING" | "FAILED";

export interface CompanyReindexState {
  companyId: number;
  activeIndexKey: string | null;
  pendingIndexKey: string | null;
  status: ReindexStatus;
  jobId: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  error: string | null;
}

function toNumeric(companyId: bigint | number | string): number {
  const n = typeof companyId === "bigint" ? Number(companyId) : Number(companyId);
  if (!Number.isFinite(n)) {
    throw new Error(`Invalid company id: ${String(companyId)}`);
  }
  return n;
}

export async function getCompanyReindexState(
  companyId: bigint | number | string,
): Promise<CompanyReindexState | null> {
  const id = toNumeric(companyId);
  const [row] = await db
    .select({
      id: company.id,
      active: company.activeEmbeddingIndexKey,
      pending: company.pendingEmbeddingIndexKey,
      status: company.reindexStatus,
      jobId: company.reindexJobId,
      startedAt: company.reindexStartedAt,
      completedAt: company.reindexCompletedAt,
      error: company.reindexError,
      legacy: company.embeddingIndexKey,
    })
    .from(company)
    .where(eq(company.id, id))
    .limit(1);

  if (!row) return null;

  return {
    companyId: row.id,
    // Fall back to the legacy column while we're in the migration window;
    // rows written before 0012 only populate `embeddingIndexKey`.
    activeIndexKey: row.active ?? row.legacy ?? null,
    pendingIndexKey: row.pending,
    status: (row.status as ReindexStatus) ?? "STABLE",
    jobId: row.jobId,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    error: row.error,
  };
}

/**
 * Resolve the index key the ingest path should use for a given company,
 * right now. During REINDEXING we bias toward the `pending` target so
 * newly uploaded documents are embedded with the new model — they'll be
 * discoverable the moment the reindex completes. Queries still use
 * `active` (see `resolveQueryIndexKey`).
 */
export async function resolveIngestIndexKey(
  companyId: bigint | number | string,
): Promise<string | null> {
  const state = await getCompanyReindexState(companyId);
  if (!state) return null;
  if (state.status === "REINDEXING" && state.pendingIndexKey) {
    return state.pendingIndexKey;
  }
  return state.activeIndexKey;
}

export async function resolveQueryIndexKey(
  companyId: bigint | number | string,
): Promise<string | null> {
  const state = await getCompanyReindexState(companyId);
  return state?.activeIndexKey ?? null;
}

export class InvalidReindexTransitionError extends Error {
  constructor(from: ReindexStatus, to: ReindexStatus) {
    super(`Invalid reindex state transition: ${from} → ${to}`);
    this.name = "InvalidReindexTransitionError";
  }
}

/**
 * Atomically begin a reindex. Returns false if another reindex is already
 * running, true if we acquired the slot. Uses an optimistic update so
 * concurrent requests can race without needing an explicit transaction.
 */
export async function beginReindex(args: {
  companyId: bigint | number | string;
  pendingIndexKey: string;
  jobId: string;
}): Promise<boolean> {
  const id = toNumeric(args.companyId);
  const now = new Date();

  // Allow STABLE → REINDEXING or FAILED → REINDEXING (retry).
  const result = await db
    .update(company)
    .set({
      pendingEmbeddingIndexKey: args.pendingIndexKey,
      reindexStatus: "REINDEXING",
      reindexJobId: args.jobId,
      reindexStartedAt: now,
      reindexError: null,
    })
    .where(eq(company.id, id))
    .returning({ status: company.reindexStatus });

  if (result.length === 0) return false;
  return true;
}

/** Promote `pending` → `active` atomically on successful reindex. */
export async function completeReindex(
  companyId: bigint | number | string,
): Promise<void> {
  const id = toNumeric(companyId);
  const now = new Date();

  const [current] = await db
    .select({ pending: company.pendingEmbeddingIndexKey })
    .from(company)
    .where(eq(company.id, id))
    .limit(1);

  if (!current?.pending) {
    throw new Error(`completeReindex: company ${id} has no pending index key`);
  }

  await db
    .update(company)
    .set({
      activeEmbeddingIndexKey: current.pending,
      // Keep legacy column in sync so other readers see the swap too.
      embeddingIndexKey: current.pending,
      pendingEmbeddingIndexKey: null,
      reindexStatus: "STABLE",
      reindexCompletedAt: now,
      reindexError: null,
    })
    .where(eq(company.id, id));
}

export async function failReindex(
  companyId: bigint | number | string,
  errorMessage: string,
): Promise<void> {
  const id = toNumeric(companyId);
  await db
    .update(company)
    .set({
      reindexStatus: "FAILED",
      reindexError: errorMessage.slice(0, 2000),
    })
    .where(eq(company.id, id));
}
