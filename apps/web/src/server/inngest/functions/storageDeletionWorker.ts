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
 * Database-backed items use the same ref-based storage helper as the other
 * adapters. The item's storageLocationId and key are passed through unchanged
 * so the active-location guard can block stale refs rather than deleting from
 * a newly configured store.
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
 * LINKED items (B5 cross-document dedup): when a batch delete finds two
 * documents referencing the same physical file, only one item ("the leader")
 * is PENDING and actually calls a provider; the others are LINKED followers.
 * processPendingItems needs no special case for them — its filter is a
 * PENDING/WAITING_RETRY allowlist, so a follower is simply never picked up.
 * finalizeRequestIfDone does the real work: it resolves a follower's state
 * off its leader on every read, and — crucially — copies the leader's final
 * outcome onto its followers immediately before the leader's document purge
 * cascades those leader rows out of existence.
 *
 * The actual work lives in plain, directly-callable functions
 * (processPendingItems / finalizeRequestIfDone) rather than inline inside
 * the Inngest handler, specifically so a test script can call them without
 * needing Inngest's own step-execution machinery running.
 */

import { eq, inArray } from "drizzle-orm";
import {
  documentVersions,
  storageDeletionItems,
  storageDeletionRequests,
  storageDeletionTombstones,
  storageObjects,
} from "@launchstack/core/db/schema";
import type { StorageDeletionItem } from "@launchstack/core/db/schema";

import { inngest } from "../client";
import { db } from "~/server/db";
import { deleteObjects } from "~/server/storage/s3-client";
import { deleteFile as deleteBlobFile } from "~/server/storage/vercel-blob";
import { deleteUploadThingFileByKey } from "~/server/storage/uploadthing";
import { purgeDocumentRelational } from "~/server/services/storage-deletion-coordinator";
import { isStorageDeletionWorkerEnabled } from "~/server/services/storage-deletion-flags";
import { deleteFileByRef } from "~/lib/storage";
import type { ObjectRef } from "@launchstack/core/storage";

export const BLOCK_AFTER_ATTEMPTS = 5;

export interface DeleteOutcome {
  outcome: "deleted" | "not_found" | "retryable" | "blocked";
  errorCode?: string;
  message?: string;
}

function normalizeDeleteResult(result: {
  outcome: DeleteOutcome["outcome"] | "rejected";
  errorCode?: string;
  message?: string;
}): DeleteOutcome {
  if (result.outcome === "rejected") {
    return {
      outcome: "blocked",
      errorCode: result.errorCode ?? "delete_rejected",
      message: result.message ?? "Storage adapter rejected the delete request",
    };
  }

  return {
    outcome: result.outcome,
    errorCode: result.errorCode,
    message: result.message,
  };
}

/** Calls the right adapter's delete function and normalizes the result. */
async function deleteByAdapter(
  adapter: string,
  storageLocationId: string,
  key: string,
): Promise<DeleteOutcome> {
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
    case "database": {
      const ref: ObjectRef = {
        adapter: "database",
        storageLocationId,
        key,
      };
      const result = await deleteFileByRef(ref);
      return normalizeDeleteResult(result);
    }
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
  if (!isStorageDeletionWorkerEnabled()) {
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

    const result = await deleteByAdapter(item.adapter, item.storageLocationId, item.key);

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
  /**
   * Requests belonging to *other* documents that had followers of this
   * request's items, and therefore had their outcome materialized and were
   * re-finalized as a result. Empty for every non-batch delete.
   */
  materializedFollowerRequestIds: number[];
}

/**
 * A LINKED item (B5 cross-document dedup) carries no outcome of its own —
 * the real outcome lives on the leader item it points at. Resolve that
 * lookup dynamically rather than copying the leader's state onto the
 * follower up front, so a leader that later moves to BLOCKED or QUARANTINED
 * drags its followers with it instead of leaving a stale duplicate behind.
 *
 * An orphaned follower (null pointer, or a leader row that no longer exists)
 * means the materialization step below failed to run before the leader's
 * document was purged. That's a broken invariant, not a transient condition,
 * so it's persisted as BLOCKED — both so the request lands in manual_review
 * instead of silently hanging, and so the admin repair path
 * (storage-deletion-admin.ts), which only acts on BLOCKED items, can reach it.
 */
async function resolveEffectiveStates(
  items: StorageDeletionItem[],
): Promise<Map<number, string>> {
  const effective = new Map<number, string>();

  const leaderIds = Array.from(
    new Set(
      items
        .filter((item) => item.itemState === "LINKED" && item.linkedToItemId !== null)
        .map((item) => Number(item.linkedToItemId)),
    ),
  );

  const leaders =
    leaderIds.length > 0
      ? await db
          .select()
          .from(storageDeletionItems)
          .where(inArray(storageDeletionItems.id, leaderIds))
      : [];
  const leaderById = new Map(leaders.map((leader) => [leader.id, leader]));

  for (const item of items) {
    if (item.itemState !== "LINKED") {
      effective.set(item.id, item.itemState);
      continue;
    }

    const leader =
      item.linkedToItemId !== null ? leaderById.get(Number(item.linkedToItemId)) : undefined;

    if (!leader) {
      const reason =
        "linked leader item is gone — its outcome was never materialized onto this follower";
      await db
        .update(storageDeletionItems)
        .set({ itemState: "BLOCKED", lastError: reason })
        .where(eq(storageDeletionItems.id, item.id));
      effective.set(item.id, "BLOCKED");
      continue;
    }

    // A leader is never itself a follower (the batch coordinator only ever
    // claims PENDING items), but don't depend on that — treat a chained
    // LINKED as simply not-yet-resolved rather than crashing.
    effective.set(item.id, leader.itemState === "LINKED" ? "WAITING_RETRY" : leader.itemState);
  }

  return effective;
}

/**
 * Re-reads every item for a request and, if all are now DELETED/NOT_FOUND,
 * purges the document's relational rows and marks the request completed.
 * If any item is QUARANTINED, marks the request "quarantined" (dominates
 * per Decision 6). Else if any item is BLOCKED, marks it "manual_review".
 * If some items are still PENDING/WAITING_RETRY, does nothing (caller
 * should retry processPendingItems later).
 */
export async function finalizeRequestIfDone(
  requestId: number,
  /**
   * Guards the follower cascade below against revisiting a request. A
   * follower is never itself a leader, so the graph is only one level deep
   * in practice — this is cheap insurance, not a load-bearing assumption.
   */
  visited: Set<number> = new Set(),
): Promise<FinalizeResult> {
  visited.add(requestId);

  const allItems = await db
    .select()
    .from(storageDeletionItems)
    .where(eq(storageDeletionItems.requestId, BigInt(requestId)));

  // LINKED items have no outcome of their own — read it off their leader.
  const effective = await resolveEffectiveStates(allItems);
  const stateOf = (item: StorageDeletionItem) => effective.get(item.id) ?? item.itemState;

  const allTerminal = allItems.every(
    (item) => stateOf(item) === "DELETED" || stateOf(item) === "NOT_FOUND",
  );
  const anyBlocked = allItems.some((item) => stateOf(item) === "BLOCKED");
  const anyQuarantined = allItems.some((item) => stateOf(item) === "QUARANTINED");

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
    } else if (
      allItems.some(
        (item) => stateOf(item) === "DELETED" || stateOf(item) === "NOT_FOUND",
      )
    ) {
      // Some items are done and some aren't, with nothing blocked or
      // quarantined outranking that: Decision 6a's "partial", applied at the
      // request level rather than the batch level. Nothing wrote this status
      // before B7 — without it the maintained summary column can never
      // represent the one state the status API most needs to explain, and
      // the read API would be silently correcting the stored value on every
      // poll.
      await db
        .update(storageDeletionRequests)
        .set({ status: "partial" })
        .where(eq(storageDeletionRequests.id, requestId));
    }
    return {
      requestId,
      allTerminal: false,
      anyBlocked,
      anyQuarantined,
      purged: false,
      materializedFollowerRequestIds: [],
    };
  }

  const [request] = await db
    .select()
    .from(storageDeletionRequests)
    .where(eq(storageDeletionRequests.id, requestId));

  if (!request) {
    throw new Error(`finalizeRequestIfDone: request ${requestId} not found`);
  }

  let purged = false;
  let materializedFollowerRequestIds: number[] = [];

  if (request.documentId !== null) {
    // storage_deletion_requests.documentId is ON DELETE CASCADE against
    // document.id — purging the document row cascades away this very
    // request row (and its items) automatically. So the tombstone —
    // which deliberately has no real FK to document, per its schema
    // comment — has to be written *before* the purge, in the same
    // transaction, or the audit trail disappears the instant the delete
    // actually completes.
    await db.transaction(async (tx) => {
      // --- B5 purge-time materialization -------------------------------
      // Any item elsewhere pointing at one of THIS request's items (a
      // follower of one of our leaders) is about to be orphaned: the
      // purge below cascades this request's items away, and
      // linked_to_item_id is ON DELETE SET NULL, so the follower would be
      // left in state LINKED pointing at nothing — with no record of what
      // actually happened to the shared file. So copy each leader's final
      // outcome onto its followers first, inside this same transaction.
      // Every item here is DELETED or NOT_FOUND (allTerminal is true), so
      // what gets copied is always a real terminal outcome.
      const leaderItemIds = allItems.map((item) => BigInt(item.id));

      // inArray with an empty list is invalid SQL in Drizzle, and a request
      // with zero items can't exist anyway (insertRequestAndItems refuses
      // to create one) — but don't let that invariant be load-bearing here.
      const followers =
        leaderItemIds.length > 0
          ? await tx
              .select({
                id: storageDeletionItems.id,
                requestId: storageDeletionItems.requestId,
              })
              .from(storageDeletionItems)
              .where(inArray(storageDeletionItems.linkedToItemId, leaderItemIds))
          : [];

      // Collected before the update below, since that update is what
      // clears linked_to_item_id and makes them unfindable this way.
      materializedFollowerRequestIds = Array.from(
        new Set(followers.map((follower) => Number(follower.requestId))),
      ).filter((id) => id !== requestId);

      if (followers.length > 0) {
        for (const leader of allItems) {
          await tx
            .update(storageDeletionItems)
            .set({
              itemState: leader.itemState,
              attempts: leader.attempts,
              lastError: leader.lastError,
              // The follower now owns its outcome outright — it no longer
              // depends on a row that's about to stop existing.
              linkedToItemId: null,
            })
            .where(eq(storageDeletionItems.linkedToItemId, BigInt(leader.id)));
        }
      }
      // -----------------------------------------------------------------

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

    // A follower request may have been waiting on nothing but this leader.
    // Nothing else will ever wake it up — its own worker run already
    // happened (and correctly concluded "not terminal yet"), and no new
    // Inngest event is emitted for it — so finalize it directly here.
    for (const followerRequestId of materializedFollowerRequestIds) {
      if (visited.has(followerRequestId)) continue;
      await finalizeRequestIfDone(followerRequestId, visited);
    }

    // The request/items rows were just cascade-deleted along with the
    // document — nothing left to mark "completed" on. The tombstone
    // above is now the permanent record.
    return {
      requestId,
      allTerminal: true,
      anyBlocked: false,
      anyQuarantined: false,
      purged,
      materializedFollowerRequestIds,
    };
  }

  // Version-scoped requests do not purge the parent document, but the
  // version row must still be removed only after every storage item is
  // terminal. Insert the tombstone before the delete because the request and
  // its items are cascaded by document_versions.
  if (request.documentVersionId !== null) {
    await db.transaction(async (tx) => {
      await tx.insert(storageDeletionTombstones).values({
        requestId: BigInt(request.id),
        companyId: request.companyId,
        documentVersionId: request.documentVersionId,
        finalStatus: "completed",
        objectCount: allItems.length,
      });
      await tx
        .delete(documentVersions)
        .where(eq(documentVersions.id, Number(request.documentVersionId)));
    });
    purged = true;
  } else {
    await db
      .update(storageDeletionRequests)
      .set({ status: "completed", completedAt: new Date() })
      .where(eq(storageDeletionRequests.id, requestId));
  }

  return {
    requestId,
    allTerminal: true,
    anyBlocked: false,
    anyQuarantined: false,
    purged,
    materializedFollowerRequestIds,
  };
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
