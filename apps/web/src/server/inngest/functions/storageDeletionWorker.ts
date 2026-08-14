/**
 * Storage Deletion Worker (B3) — core logic + Inngest wiring.
 *
 * Fires when B2 creates a storage_deletion_requests row. Does the actual
 * provider-level delete for every PENDING/WAITING_RETRY item on that
 * request, then — once every item is in a terminal state (DELETED or
 * NOT_FOUND) — purges the document's relational rows via B2's
 * purgeDocumentRelational.
 *
 * Retry model (per item):
 *   - Inngest's own step-level retries (see `retries` below) handle
 *     transient failures for free — those don't count against our own
 *     budget.
 *   - Only once Inngest gives up on a given attempt do we increment the
 *     item's own `attempts` counter. After BLOCK_AFTER_ATTEMPTS (5) failed
 *     attempts, the item is marked BLOCKED and the request is left
 *     incomplete for a human to look at (future B7 status API).
 *
 * "database"-adapter items: NOT handled by this worker. Per the design doc
 * (task A3, "Database-backed delete"), the real fix for deleting
 * file_uploads rows belongs to Dev A, alongside the S3/Blob/UploadThing
 * adapters. Until that lands, database-adapter items are deliberately
 * marked BLOCKED (not silently skipped, not faked as deleted) so nothing
 * in this system quietly reinvents that piece.
 *
 * storage_objects.lifecycleState: this worker only touches the two states
 * it needs to make cancellation (coordinator's cancelDeletionRequest) and
 * the admin repair path (storage-deletion-admin.ts) meaningful:
 *   - flips a manifest-backed object to STORAGE_DELETING right before
 *     attempting its delete (so "already started" is a real, checkable
 *     fact, not a guess)
 *   - skips (never touches) an object that's been flipped to CANCELLED
 *   - flips an object to BLOCKED when its item becomes BLOCKED, so the
 *     admin repair path has something real to flip back
 * The rest of the state machine (STORAGE_CLEAN, RELATIONAL_PURGE, PURGED)
 * is still deliberately deferred to B6 — this worker's own item-state
 * tracking (storage_deletion_items) remains the real source of truth for
 * "is this item actually done," same as before.
 *
 * The actual work lives in plain, directly-callable functions
 * (processPendingItems / finalizeRequestIfDone) rather than inline inside
 * the Inngest handler, specifically so a test script can call them without
 * needing Inngest's own step-execution machinery running.
 */

import { eq } from "drizzle-orm";
import {
  storageDeletionItems,
  storageDeletionRequests,
  storageDeletionTombstones,
  storageObjects,
} from "@launchstack/core/db/schema";

import { inngest } from "../client";
import { db } from "~/server/db";
import { deleteObjects } from "~/server/storage/s3-client";
import { deleteFile as deleteBlobFile } from "~/server/storage/vercel-blob";
import { deleteUploadThingFileByKey } from "~/server/storage/uploadthing";
import { purgeDocumentRelational } from "~/server/services/storage-deletion-coordinator";

export const BLOCK_AFTER_ATTEMPTS = 5;

export interface DeleteOutcome {
  outcome: "deleted" | "not_found" | "retryable" | "blocked";
  errorCode?: string;
  message?: string;
}

/**
 * Is the worker allowed to run right now? Matches the raw-env-var pattern
 * the existing A6a test already expects (STORAGE_DELETION_LIFECYCLE_ENABLED)
 * — no formal env.ts entry yet, that's Dev C's flag to own/wire up
 * properly. Default is OFF per the design doc (Decision 7): unset or
 * anything other than "true"/"1" means paused.
 */
function isWorkerEnabled(): boolean {
  const raw = process.env.STORAGE_DELETION_WORKER_ENABLED;
  return raw === "true" || raw === "1";
}

/** Calls the right adapter's delete function and normalizes the result. */
async function deleteByAdapter(adapter: string, key: string): Promise<DeleteOutcome> {
  switch (adapter) {
    case "s3": {
      const [result] = await deleteObjects([key]);
      return result ?? { outcome: "retryable", message: "deleteObjects returned no result" };
    }
    case "vercel-blob": {
      try {
        await deleteBlobFile(key);
        return { outcome: "deleted" };
      } catch (err) {
        return {
          outcome: "retryable",
          errorCode: "vercel_blob_delete_failed",
          message: err instanceof Error ? err.message : String(err),
        };
      }
    }
    case "uploadthing":
      return deleteUploadThingFileByKey(key);
    case "database":
      // Dev A owns this (design doc task A3). Not implemented here on
      // purpose — see file header comment.
      return {
        outcome: "blocked",
        errorCode: "database_adapter_not_yet_implemented",
        message: "database-adapter delete is Dev A's A3 task and isn't wired up yet",
      };
    default:
      // Unknown adapter — not transient, a human needs to look at this.
      return {
        outcome: "blocked",
        errorCode: "unknown_adapter",
        message: `deleteByAdapter: no delete handler for adapter "${adapter}"`,
      };
  }
}

export interface ProcessPendingItemsResult {
  skipped: boolean;
  reason?: string;
}

/**
 * Attempts every PENDING/WAITING_RETRY item for a request once. Updates
 * each item's state directly. Safe to call repeatedly (idempotent w.r.t.
 * items already in a terminal state — it only looks at non-terminal ones).
 *
 * No-ops entirely (leaves every item untouched — "outbox intact") if the
 * worker's kill switch is off.
 */
export async function processPendingItems(requestId: number): Promise<ProcessPendingItemsResult> {
  if (!isWorkerEnabled()) {
    return { skipped: true, reason: "STORAGE_DELETION_WORKER_ENABLED is not on" };
  }

  const items = await db
    .select()
    .from(storageDeletionItems)
    .where(eq(storageDeletionItems.requestId, BigInt(requestId)));

  const itemsToProcess = items.filter(
    (item) => item.itemState === "PENDING" || item.itemState === "WAITING_RETRY",
  );

  for (const item of itemsToProcess) {
    // Manifest-backed items carry a real storage_objects row — check/flip
    // its lifecycle state before touching the actual file.
    if (item.objectId !== null) {
      const [obj] = await db
        .select()
        .from(storageObjects)
        .where(eq(storageObjects.id, Number(item.objectId)));

      if (obj?.lifecycleState === "CANCELLED") {
        // Cancelled after the request was created, before we got to it —
        // leave both the object and this item alone entirely.
        continue;
      }

      await db
        .update(storageObjects)
        .set({ lifecycleState: "STORAGE_DELETING" })
        .where(eq(storageObjects.id, Number(item.objectId)));
    }

    const result = await deleteByAdapter(item.adapter, item.key);

    if (result.outcome === "deleted" || result.outcome === "not_found") {
      await db
        .update(storageDeletionItems)
        .set({
          itemState: result.outcome === "deleted" ? "DELETED" : "NOT_FOUND",
          lastError: null,
        })
        .where(eq(storageDeletionItems.id, item.id));
      continue;
    }

    // retryable or blocked (from the adapter's own judgment, e.g. an
    // auth error) — either way, this counts as one real attempt.
    const nextAttempts = item.attempts + 1;
    const forceBlocked = result.outcome === "blocked" || nextAttempts >= BLOCK_AFTER_ATTEMPTS;

    await db
      .update(storageDeletionItems)
      .set({
        itemState: forceBlocked ? "BLOCKED" : "WAITING_RETRY",
        attempts: nextAttempts,
        lastError: result.message ?? result.errorCode ?? "delete failed",
      })
      .where(eq(storageDeletionItems.id, item.id));

    if (forceBlocked && item.objectId !== null) {
      await db
        .update(storageObjects)
        .set({ lifecycleState: "BLOCKED" })
        .where(eq(storageObjects.id, Number(item.objectId)));
    }
  }

  return { skipped: false };
}

export interface FinalizeResult {
  requestId: number;
  allTerminal: boolean;
  anyBlocked: boolean;
  anyQuarantined: boolean;
  purged: boolean;
}

/**
 * Re-reads every item for a request and, if all are now DELETED/NOT_FOUND,
 * purges the document's relational rows and marks the request completed.
 * If any item is QUARANTINED, marks the request "quarantined" (dominates
 * per Decision 6). Else if any item is BLOCKED, marks it "manual_review".
 * If some items are still PENDING/WAITING_RETRY, does nothing (caller
 * should retry processPendingItems later).
 */
export async function finalizeRequestIfDone(requestId: number): Promise<FinalizeResult> {
  const allItems = await db
    .select()
    .from(storageDeletionItems)
    .where(eq(storageDeletionItems.requestId, BigInt(requestId)));

  const allTerminal = allItems.every(
    (item) => item.itemState === "DELETED" || item.itemState === "NOT_FOUND",
  );
  const anyBlocked = allItems.some((item) => item.itemState === "BLOCKED");
  const anyQuarantined = allItems.some((item) => item.itemState === "QUARANTINED");

  if (!allTerminal) {
    // "quarantined" dominates "manual_review" per Decision 6.
    if (anyQuarantined) {
      await db
        .update(storageDeletionRequests)
        .set({ status: "quarantined" })
        .where(eq(storageDeletionRequests.id, requestId));
    } else if (anyBlocked) {
      // "manual_review" is the closest fit in the requests status enum
      // (queued/completed/partial/manual_review/quarantined) — there's no
      // dedicated "blocked" value at the request level, only at the item
      // level.
      await db
        .update(storageDeletionRequests)
        .set({ status: "manual_review" })
        .where(eq(storageDeletionRequests.id, requestId));
    }
    return { requestId, allTerminal: false, anyBlocked, anyQuarantined, purged: false };
  }

  const [request] = await db
    .select()
    .from(storageDeletionRequests)
    .where(eq(storageDeletionRequests.id, requestId));

  if (!request) {
    throw new Error(`finalizeRequestIfDone: request ${requestId} not found`);
  }

  let purged = false;
  if (request.documentId !== null) {
    // storage_deletion_requests.documentId is ON DELETE CASCADE against
    // document.id — purging the document row cascades away this very
    // request row (and its items) automatically. So the tombstone —
    // which deliberately has no real FK to document, per its schema
    // comment — has to be written *before* the purge, in the same
    // transaction, or the audit trail disappears the instant the delete
    // actually completes.
    await db.transaction(async (tx) => {
      await tx.insert(storageDeletionTombstones).values({
        requestId: BigInt(request.id),
        companyId: request.companyId,
        documentId: request.documentId,
        finalStatus: "completed",
        objectCount: allItems.length,
      });
      await purgeDocumentRelational(tx, Number(request.documentId));
    });
    purged = true;

    // The request/items rows were just cascade-deleted along with the
    // document — nothing left to mark "completed" on. The tombstone
    // above is now the permanent record.
    return { requestId, allTerminal: true, anyBlocked: false, anyQuarantined: false, purged };
  }

  // documentVersionId-scoped requests (single-version delete) don't purge
  // the parent document — there's no equivalent "purge just this version"
  // relational step defined yet. Leaving that as a known gap for now.
  // (No cascade risk here yet either, since nothing deletes the document
  // in this branch — the request row survives on its own.)
  await db
    .update(storageDeletionRequests)
    .set({ status: "completed", completedAt: new Date() })
    .where(eq(storageDeletionRequests.id, requestId));

  return { requestId, allTerminal: true, anyBlocked: false, anyQuarantined: false, purged };
}

export const storageDeletionWorker = inngest.createFunction(
  {
    id: "storage-deletion-worker",
    name: "Storage Deletion Worker",
    retries: 3,
    onFailure: async ({ error, event }) => {
      console.error(
        `[StorageDeletionWorker] failed: ${JSON.stringify(event.data)}`,
        error,
      );
    },
  },
  { event: "storage-deletion/request.created" },
  async ({ event, step }) => {
    const { requestId } = event.data as { requestId: number };

    await step.run("process-pending-items", () => processPendingItems(requestId));

    const result = await step.run("finalize-if-done", () => finalizeRequestIfDone(requestId));

    return result;
  },
);
