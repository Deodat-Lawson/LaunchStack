/**
 * Storage Deletion Retry Sweep (B3 — "retry only failed/unknown with backoff").
 *
 * THE GAP THIS CLOSES
 * -------------------
 * storageDeletionWorker only fires on "storage-deletion/request.created".
 * Nothing else ever invoked it. So an item the worker set to WAITING_RETRY —
 * a transient S3 blip, a network timeout — was never looked at again: its
 * request never completed, its document never purged, and its bytes stayed in
 * storage forever. The retry state was written and then consumed by nobody,
 * which is the exact failure mode this whole project exists to fix, wearing a
 * different hat.
 *
 * This sweep is the missing trigger. It also rescues requests orphaned for
 * reasons the worker can't know about — a run that died mid-flight, an event
 * that was never delivered — because it works from durable database state
 * rather than from a chain of scheduled follow-ups. That is why it is a cron
 * rather than the worker re-sending its own event: a re-dispatch chain is only
 * as reliable as its weakest link, and any break in it strands that request
 * permanently.
 *
 * BACKOFF
 * -------
 * Per item, from its own attempt count: roughly 2^attempts minutes, capped.
 * An item that just failed waits a minute; one that has failed four times
 * waits sixteen. Eligibility is computed off updated_at, which the schema
 * maintains via $onUpdate, so a retry can't happen sooner than the backoff
 * regardless of how often this runs.
 *
 * A freshly created request is left alone for MIN_AGE_MINUTES so the sweep
 * doesn't race the "request.created" event that is already in flight for it.
 *
 * Re-dispatching is safe to do more than once: processPendingItems only looks
 * at non-terminal items, and every delete goes out through an idempotent
 * ref-based call.
 */

import { inArray } from "drizzle-orm";
import { storageDeletionItems } from "@launchstack/core/db/schema";

import { inngest } from "../client";
import { db } from "~/server/db";
import { isStorageDeletionWorkerEnabled } from "~/server/storage/deletion-flags";

/** Item states that still want another attempt. */
const RETRIABLE_STATES = ["PENDING", "WAITING_RETRY"] as const;

/** Don't touch a request younger than this — its own event is still in flight. */
const MIN_AGE_MINUTES = 2;

/** Ceiling on the per-item exponential backoff. */
const MAX_BACKOFF_MINUTES = 60;

/** Most requests to wake in one run, so a large backlog drains gradually. */
const MAX_REQUESTS_PER_RUN = 25;

/** Roughly 2^attempts minutes, floored at MIN_AGE_MINUTES and capped. */
export function backoffMinutes(attempts: number): number {
  const exponential = Math.pow(2, Math.max(0, attempts));
  return Math.min(Math.max(exponential, MIN_AGE_MINUTES), MAX_BACKOFF_MINUTES);
}

export interface SweepResult {
  skipped: boolean;
  reason?: string;
  /** Requests whose worker event was re-sent. */
  requeuedRequestIds: number[];
  /** Retriable items found but not yet due under their backoff. */
  waitingOnBackoff: number;
}

/**
 * Plain, directly-callable so a test script can run it without Inngest's
 * step machinery — same split as the worker.
 */
export interface SweepDeps {
  /**
   * Defaults to sending the real Inngest event. Injectable so a test can run
   * the sweep without a live Inngest dev server — inngest.send() fails with
   * "401 Event key not found" against a local-only key, which would make this
   * untestable rather than merely unverified.
   */
  dispatch?: (requestIds: number[]) => Promise<void>;
}

export async function sweepStalledDeletionRequests(
  now = new Date(),
  deps: SweepDeps = {},
): Promise<SweepResult> {
  if (!isStorageDeletionWorkerEnabled()) {
    // Same contract as the worker: the kill switch pauses processing with the
    // outbox fully intact. A paused sweep must not consume backoff either.
    return {
      skipped: true,
      reason: "STORAGE_DELETION_WORKER_ENABLED is not on",
      requeuedRequestIds: [],
      waitingOnBackoff: 0,
    };
  }

  const candidates = await db
    .select({
      requestId: storageDeletionItems.requestId,
      attempts: storageDeletionItems.attempts,
      updatedAt: storageDeletionItems.updatedAt,
      createdAt: storageDeletionItems.createdAt,
    })
    .from(storageDeletionItems)
    .where(inArray(storageDeletionItems.itemState, [...RETRIABLE_STATES]));

  const due = new Set<number>();
  let waitingOnBackoff = 0;

  for (const item of candidates) {
    const lastTouched = item.updatedAt ?? item.createdAt;
    const ageMinutes = (now.getTime() - new Date(lastTouched).getTime()) / 60_000;

    if (ageMinutes >= backoffMinutes(item.attempts)) {
      due.add(Number(item.requestId));
    } else {
      waitingOnBackoff += 1;
    }
  }

  const requeuedRequestIds = Array.from(due).slice(0, MAX_REQUESTS_PER_RUN);

  if (requeuedRequestIds.length > 0) {
    const dispatch =
      deps.dispatch ??
      (async (ids: number[]) => {
        await inngest.send(
          ids.map((requestId) => ({
            name: "storage-deletion/request.created",
            data: { requestId },
          })),
        );
      });
    await dispatch(requeuedRequestIds);
  }

  // Never silently cap: if the backlog is bigger than one run, say so.
  if (due.size > requeuedRequestIds.length) {
    console.warn(
      `[StorageDeletionSweep] ${due.size} requests are due but only ` +
        `${requeuedRequestIds.length} were re-dispatched this run ` +
        `(MAX_REQUESTS_PER_RUN=${MAX_REQUESTS_PER_RUN}); the rest follow next run.`,
    );
  }

  return { skipped: false, requeuedRequestIds, waitingOnBackoff };
}

export const storageDeletionSweep = inngest.createFunction(
  {
    id: "storage-deletion-sweep",
    name: "Storage Deletion Retry Sweep",
    retries: 2,
    onFailure: async ({ error }) => {
      console.error("[StorageDeletionSweep] failed:", error);
    },
  },
  { cron: "*/5 * * * *" },
  async ({ step }) => {
    return step.run("sweep-stalled-requests", () => sweepStalledDeletionRequests());
  },
);
