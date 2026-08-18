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
 * finalizeRequestIfDone then completes the state machine: STORAGE_CLEAN once
 * every item is terminal, and RELATIONAL_PURGE in the same transaction as the
 * purge. There is no PURGED write — storage_objects.document_id is ON DELETE
 * CASCADE, so a purged document's manifest rows no longer exist; PURGED is
 * the row's absence plus the tombstone. storage_deletion_items remains the
 * source of truth for "is this item actually done"; the object lifecycle is
 * what serve-gating and the admin paths read.
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
import {
  purgeDocumentRelational,
  refIdentity,
} from "~/server/services/storage-deletion-coordinator";
import { isStorageDeletionWorkerEnabled } from "~/server/storage/deletion-flags";
import { deleteManyByRef } from "~/lib/storage";
import { mapDeleteOutcomeToItemState } from "~/server/storage/deletion-lifecycle";
import type { DeleteResult, ObjectRef } from "@launchstack/core/storage";

export const BLOCK_AFTER_ATTEMPTS = 5;

const SUPPORTED_ADAPTERS = new Set(["s3", "vercel-blob", "database", "uploadthing"]);

function isSupportedAdapter(adapter: string): adapter is ObjectRef["adapter"] {
  return SUPPORTED_ADAPTERS.has(adapter);
}

export interface ProcessPendingItemsResult {
  skipped: boolean;
  reason?: string;
}

/**
 * Seams for tests. Both default to the real thing; nothing in production
 * passes them.
 *
 * These exist because three rows of the design doc's failure matrix cannot
 * be produced from outside otherwise. A provider timeout, a provider that
 * rejects, and a SQL purge that fails after storage is already clean are all
 * states you have to inject — waiting for a real S3 timeout is not a test.
 * The alternative was asserting nothing and calling the row covered.
 */
export interface WorkerDeps {
  /** Defaults to Dev A's deleteManyByRef. */
  deleteMany?: (refs: readonly ObjectRef[]) => Promise<DeleteResult[]>;
}

export interface FinalizeDeps {
  /** Defaults to B2's purgeDocumentRelational. */
  purge?: typeof purgeDocumentRelational;
}

/**
 * Attempts every PENDING/WAITING_RETRY item for a request once. Updates
 * each item's state directly. Safe to call repeatedly (idempotent w.r.t.
 * items already in a terminal state — it only looks at non-terminal ones).
 *
 * No-ops entirely (leaves every item untouched — "outbox intact") if the
 * worker's kill switch is off.
 *
 * DELETE PATH (design doc B3 item 2)
 * ----------------------------------
 * Refs go out through Dev A's deleteManyByRef, which groups by
 * (adapter, storageLocationId) and batches where the provider supports it —
 * one S3 DeleteObjects call for the whole group instead of one call per key.
 * Two consequences beyond fewer round trips:
 *
 *  - the Decision 4 stale-location guard actually runs. The previous
 *    per-adapter switch passed only the raw key for s3 / vercel-blob /
 *    uploadthing, so a ref minted against an old bucket or Blob store would
 *    have been deleted out of whatever store is configured *now*. It is now
 *    reported blocked instead, which is the documented behavior.
 *  - outcomes come back per ref, so a partial batch failure retries only the
 *    refs that actually failed (design doc A7).
 *
 * Items are grouped by refIdentity first, so two items naming the same
 * physical file within one request cost one provider call, not two.
 *
 * OUTCOME MAPPING (design doc B3 item 3 / Decision 2)
 * --------------------------------------------------
 * mapDeleteOutcomeToItemState is the single frozen mapping, shared with the
 * adapter side rather than restated here. Note "rejected" maps to
 * QUARANTINED, not BLOCKED — the two are different things: BLOCKED is
 * "retryable by a human after a fix" (admin requeue), QUARANTINED is
 * "refused, needs an approved exception" and dominates request status.
 */
export async function processPendingItems(
  requestId: number,
  deps: WorkerDeps = {},
): Promise<ProcessPendingItemsResult> {
  const deleteMany = deps.deleteMany ?? deleteManyByRef;

  if (!isStorageDeletionWorkerEnabled()) {
    return { skipped: true, reason: "STORAGE_DELETION_WORKER_ENABLED is not on" };
  }

  const items = await db
    .select()
    .from(storageDeletionItems)
    .where(eq(storageDeletionItems.requestId, BigInt(requestId)));

  const candidates = items.filter(
    (item) => item.itemState === "PENDING" || item.itemState === "WAITING_RETRY",
  );
  if (candidates.length === 0) return { skipped: false };

  // Manifest-backed items carry a real storage_objects row. An object that
  // was cancelled after the request was created is left completely alone —
  // both it and its item stay exactly as they are.
  const objectIds = Array.from(
    new Set(
      candidates
        .filter((item) => item.objectId !== null)
        .map((item) => Number(item.objectId)),
    ),
  );

  const lifecycleById = new Map<number, string>();
  if (objectIds.length > 0) {
    const objects = await db
      .select({ id: storageObjects.id, lifecycleState: storageObjects.lifecycleState })
      .from(storageObjects)
      .where(inArray(storageObjects.id, objectIds));
    for (const obj of objects) lifecycleById.set(obj.id, obj.lifecycleState);
  }

  const processable = candidates.filter((item) => {
    if (item.objectId === null) return true;
    return lifecycleById.get(Number(item.objectId)) !== "CANCELLED";
  });
  if (processable.length === 0) return { skipped: false };

  // "Deletion has actually started" becomes a real, checkable fact before any
  // provider is touched — this is what cancelDeletionRequest refuses against.
  const startingObjectIds = processable
    .filter((item) => item.objectId !== null)
    .map((item) => Number(item.objectId));
  if (startingObjectIds.length > 0) {
    await db
      .update(storageObjects)
      .set({ lifecycleState: "STORAGE_DELETING" })
      .where(inArray(storageObjects.id, startingObjectIds));
  }

  // One provider call per distinct physical file, not per item.
  const refsByIdentity = new Map<string, ObjectRef>();
  const unsupported = new Map<string, string>();
  for (const item of processable) {
    const identity = refIdentity(item);
    if (refsByIdentity.has(identity) || unsupported.has(identity)) continue;

    if (!isSupportedAdapter(item.adapter)) {
      // Not transient and not the provider's fault — a human needs to look.
      unsupported.set(identity, item.adapter);
      continue;
    }
    refsByIdentity.set(identity, {
      adapter: item.adapter,
      storageLocationId: item.storageLocationId,
      key: item.key,
    });
  }

  const results =
    refsByIdentity.size > 0 ? await deleteMany(Array.from(refsByIdentity.values())) : [];

  // deleteManyByRef returns results grouped by (adapter, storageLocationId),
  // NOT in input order — match them back by identity rather than by index.
  const resultByIdentity = new Map<string, DeleteResult>();
  for (const result of results) resultByIdentity.set(refIdentity(result.ref), result);

  for (const item of processable) {
    const identity = refIdentity(item);

    const unsupportedAdapter = unsupported.get(identity);
    const result: DeleteResult | undefined = unsupportedAdapter
      ? {
          ref: {
            adapter: "database",
            storageLocationId: item.storageLocationId,
            key: item.key,
          },
          outcome: "blocked",
          errorCode: "unknown_adapter",
          message: `No delete handler for adapter "${unsupportedAdapter}"`,
        }
      : resultByIdentity.get(identity);

    const outcome: DeleteResult = result ?? {
      ref: {
        adapter: "database",
        storageLocationId: item.storageLocationId,
        key: item.key,
      },
      outcome: "retryable",
      errorCode: "missing_delete_outcome",
      message: `No delete outcome returned for key "${item.key}".`,
    };

    let itemState = mapDeleteOutcomeToItemState(outcome);

    if (itemState === "DELETED" || itemState === "NOT_FOUND") {
      await db
        .update(storageDeletionItems)
        .set({ itemState, lastError: null })
        .where(eq(storageDeletionItems.id, item.id));
      continue;
    }

    // Everything else counts as one real attempt against our own budget.
    // (Inngest's step-level retries happen above this and are free.)
    const nextAttempts = item.attempts + 1;

    // A retryable failure that has burned the budget stops being retryable.
    if (itemState === "WAITING_RETRY" && nextAttempts >= BLOCK_AFTER_ATTEMPTS) {
      itemState = "BLOCKED";
    }

    await db
      .update(storageDeletionItems)
      .set({
        itemState,
        attempts: nextAttempts,
        lastError: outcome.message ?? outcome.errorCode ?? "delete failed",
      })
      .where(eq(storageDeletionItems.id, item.id));

    // Mirror the terminal-ish states onto the manifest row so the admin
    // repair path (BLOCKED -> requeue / quarantine) has something real to act
    // on, and so B6's serve gate keeps refusing the document.
    if (item.objectId !== null && (itemState === "BLOCKED" || itemState === "QUARANTINED")) {
      await db
        .update(storageObjects)
        .set({ lifecycleState: itemState })
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
  deps: FinalizeDeps = {},
): Promise<FinalizeResult> {
  const purge = deps.purge ?? purgeDocumentRelational;
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

  // ---- Lifecycle: STORAGE_CLEAN (design doc B3 item 4) ----------------
  // Every item is terminal, so every byte this request owned is confirmed
  // gone from its provider. Record that on the manifest rows before touching
  // any relational data — if the purge below fails, these objects are left
  // truthfully marked "storage is clean, database is not", which is exactly
  // the state a human debugging a stuck purge needs to see.
  const manifestObjectIds = Array.from(
    new Set(
      allItems
        .filter((item) => item.objectId !== null)
        .map((item) => Number(item.objectId)),
    ),
  );

  if (manifestObjectIds.length > 0) {
    await db
      .update(storageObjects)
      .set({ lifecycleState: "STORAGE_CLEAN" })
      .where(inArray(storageObjects.id, manifestObjectIds));
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

      // ---- Lifecycle: RELATIONAL_PURGE -------------------------------
      // Set in the same transaction as the purge itself. On the happy path
      // no one ever observes it, because the cascade below deletes these
      // rows moments later — but if the purge throws, the transaction rolls
      // back and the objects stay at STORAGE_CLEAN, so the pair is never
      // inconsistent. The state earns its keep in the crash case, not the
      // success case.
      //
      // There is deliberately no PURGED write. storage_objects.document_id
      // is ON DELETE CASCADE, so a purged document's manifest rows cease to
      // exist — there is nothing left to label. PURGED is represented by the
      // row's absence plus the tombstone, which is the permanent record and
      // the thing that survives on purpose.
      if (manifestObjectIds.length > 0) {
        await tx
          .update(storageObjects)
          .set({ lifecycleState: "RELATIONAL_PURGE" })
          .where(inArray(storageObjects.id, manifestObjectIds));
      }

      await tx.insert(storageDeletionTombstones).values({
        requestId: BigInt(request.id),
        companyId: request.companyId,
        documentId: request.documentId,
        finalStatus: "completed",
        objectCount: allItems.length,
      });
      await purge(tx, Number(request.documentId));
    });
    purged = true;

    // A follower request may have been waiting on nothing but this leader.
    // Nothing else will ever wake it up — its own worker run already
    // happened (and correctly concluded "not terminal yet"), and no new
    // Inngest event is emitted for it — so finalize it directly here.
    for (const followerRequestId of materializedFollowerRequestIds) {
      if (visited.has(followerRequestId)) continue;
      await finalizeRequestIfDone(followerRequestId, visited, deps);
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
      if (manifestObjectIds.length > 0) {
        await tx
          .update(storageObjects)
          .set({ lifecycleState: "RELATIONAL_PURGE" })
          .where(inArray(storageObjects.id, manifestObjectIds));
      }

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
