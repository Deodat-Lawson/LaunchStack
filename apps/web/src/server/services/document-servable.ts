/**
 * Serve-gating — B6.
 *
 * Closes the window between "a delete was requested" and "the delete actually
 * finished". During that window the document's relational rows still exist, so
 * every read path would happily keep serving a file that is being deleted, or
 * one whose deletion is stuck and needs a human. This module is the single
 * shared check every content route calls before serving anything.
 *
 * WHAT IT READS, AND WHY NOT lifecycleState
 * -----------------------------------------
 * The design doc phrases the gated set as storage_objects lifecycle states
 * (DELETE_REQUESTED / STORAGE_DELETING / BLOCKED / QUARANTINED). This module
 * deliberately does NOT read storage_objects as its primary signal, because
 * legacy (pre-manifest) documents have no storage_objects rows at all — their
 * refs exist only as storage_deletion_items. A lifecycleState-driven gate
 * would silently fail to protect exactly the documents most at risk, which is
 * worse than no gate.
 *
 * So the source of truth is storage_deletion_requests + storage_deletion_items,
 * which exist for every document on both paths. lifecycleState is still read,
 * but only as a *secondary* signal for the two things items alone can't tell
 * us: whether a provider call is genuinely in flight, and whether the request
 * was cancelled.
 *
 * This also means B6 needs no new lifecycle states. The deferred
 * STORAGE_CLEAN / RELATIONAL_PURGE / PURGED states are all post-storage-clean,
 * and the gating window closes when the document row is purged — at which
 * point every route 404s on its own. Nothing to add.
 *
 * CANCELLATION
 * ------------
 * cancelDeletionRequest deliberately leaves the request row in place forever
 * (documented there: "the request just never completes"). A gate that refused
 * whenever any request row existed would therefore turn a cancelled delete
 * into a permanent soft-delete. So an item whose linked object is CANCELLED is
 * treated as not gating.
 *
 * STATUS CODE
 * -----------
 * All refusals are 410 Gone, not 404. In every gated state a delete was
 * requested, so "this used to exist and is going away" is the honest answer;
 * 404 keeps its existing meaning of "no such row". Callers of these routes are
 * already tenant-authorized, so 410 discloses nothing they couldn't see.
 */

import { and, eq, inArray, ne } from "drizzle-orm";
import {
  storageDeletionItems,
  storageDeletionRequests,
  storageDeletionTombstones,
  storageObjects,
} from "@launchstack/core/db/schema";
import type { StorageDeletionItem } from "@launchstack/core/db/schema";

import { db } from "~/server/db";

export type ServeRefusalReason =
  | "delete_requested"
  | "storage_deleting"
  | "blocked"
  | "quarantined"
  | "already_deleted";

export interface ServableVerdict {
  servable: boolean;
  reason?: ServeRefusalReason;
  /** HTTP status a route should return when servable is false. Always 410. */
  status?: number;
  message?: string;
}

const SERVABLE: ServableVerdict = { servable: true };

const REFUSAL_MESSAGES: Record<ServeRefusalReason, string> = {
  delete_requested: "This document is being deleted and is no longer available.",
  storage_deleting: "This document is being deleted and is no longer available.",
  blocked:
    "This document's deletion could not be completed and it is pending review. It is no longer available.",
  quarantined:
    "This document's deletion was quarantined and it is pending review. It is no longer available.",
  already_deleted: "This document has been deleted.",
};

function refuse(reason: ServeRefusalReason): ServableVerdict {
  return { servable: false, reason, status: 410, message: REFUSAL_MESSAGES[reason] };
}

/** Thrown by the assert* wrappers. Carries the verdict so callers can map it. */
export class DocumentNotServableError extends Error {
  constructor(readonly verdict: ServableVerdict) {
    super(verdict.message ?? "Document is not servable");
    this.name = "DocumentNotServableError";
  }
}

/**
 * The heart of the gate: given every deletion item that covers whatever is
 * about to be served, decide whether serving is still allowed.
 *
 * Severity order matters — a document with one quarantined item and one
 * pending item should report "quarantined", the state a human needs to act on,
 * rather than the blander "delete_requested". This mirrors Decision 6's rule
 * that quarantined dominates manual_review.
 */
async function verdictForItems(items: StorageDeletionItem[]): Promise<ServableVerdict> {
  if (items.length === 0) return SERVABLE;

  // Manifest-backed items carry a storage_objects row whose lifecycleState
  // tells us two things the item state can't: that a provider call is really
  // in flight, and that the request was cancelled.
  const objectIds = items
    .map((item) => item.objectId)
    .filter((id): id is bigint => id !== null)
    .map((id) => Number(id));

  const objects =
    objectIds.length > 0
      ? await db.select().from(storageObjects).where(inArray(storageObjects.id, objectIds))
      : [];
  const lifecycleByObjectId = new Map(objects.map((obj) => [obj.id, obj.lifecycleState]));

  const lifecycleOf = (item: StorageDeletionItem) =>
    item.objectId !== null ? lifecycleByObjectId.get(Number(item.objectId)) : undefined;

  // Cancelled items don't gate anything — see the CANCELLATION note above.
  const live = items.filter((item) => lifecycleOf(item) !== "CANCELLED");
  if (live.length === 0) return SERVABLE;

  if (live.some((item) => item.itemState === "QUARANTINED")) return refuse("quarantined");
  if (live.some((item) => item.itemState === "BLOCKED")) return refuse("blocked");

  const deleting = live.some(
    (item) =>
      item.itemState === "IN_FLIGHT" ||
      item.itemState === "WAITING_RETRY" ||
      item.itemState === "RETRYABLE_FAILED" ||
      lifecycleOf(item) === "STORAGE_DELETING",
  );
  if (deleting) return refuse("storage_deleting");

  // LINKED counts as requested: the shared file is being deleted by another
  // document's leader item, which is just as fatal for serving this one.
  if (live.some((item) => item.itemState === "PENDING" || item.itemState === "LINKED")) {
    return refuse("delete_requested");
  }

  // Everything left is DELETED / NOT_FOUND — the storage delete succeeded.
  // The relational rows may still exist (the purge happens in a later step,
  // or not at all for a version-scoped request), which is precisely the case
  // the design doc's test bullet calls out. Refuse anyway.
  return refuse("already_deleted");
}

/** Is it currently okay to serve this document's content to anyone? */
export async function checkDocumentServable(docId: number): Promise<ServableVerdict> {
  // A tombstone outlives the document itself — it's the only trace left after
  // a purge, and the only way to answer correctly if a row somehow survives.
  const [tombstone] = await db
    .select()
    .from(storageDeletionTombstones)
    .where(eq(storageDeletionTombstones.documentId, BigInt(docId)));

  if (tombstone) {
    return refuse(tombstone.finalStatus === "quarantined" ? "quarantined" : "already_deleted");
  }

  const requests = await db
    .select({ id: storageDeletionRequests.id })
    .from(storageDeletionRequests)
    .where(
      and(
        eq(storageDeletionRequests.documentId, BigInt(docId)),
        ne(storageDeletionRequests.intent, "object_cleanup"),
      ),
    );

  if (requests.length === 0) return SERVABLE;

  const items = await db
    .select()
    .from(storageDeletionItems)
    .where(
      inArray(
        storageDeletionItems.requestId,
        requests.map((request) => BigInt(request.id)),
      ),
    );

  // A request with no items shouldn't exist (insertRequestAndItems refuses to
  // create one), but if it somehow does, fail closed rather than open.
  if (items.length === 0) return refuse("delete_requested");

  return verdictForItems(items);
}

/**
 * Is it currently okay to serve one specific version's content?
 *
 * Gated by two things: a whole-document delete (which takes every version with
 * it), and a version-scoped delete request for this version alone.
 */
export async function checkVersionServable(params: {
  documentId: number;
  versionId: number;
}): Promise<ServableVerdict> {
  const documentVerdict = await checkDocumentServable(params.documentId);
  if (!documentVerdict.servable) return documentVerdict;

  const [tombstone] = await db
    .select()
    .from(storageDeletionTombstones)
    .where(eq(storageDeletionTombstones.documentVersionId, BigInt(params.versionId)));

  if (tombstone) {
    return refuse(tombstone.finalStatus === "quarantined" ? "quarantined" : "already_deleted");
  }

  const requests = await db
    .select({ id: storageDeletionRequests.id })
    .from(storageDeletionRequests)
    .where(
      and(
        eq(storageDeletionRequests.documentVersionId, BigInt(params.versionId)),
        ne(storageDeletionRequests.intent, "object_cleanup"),
      ),
    );

  if (requests.length === 0) return SERVABLE;

  const items = await db
    .select()
    .from(storageDeletionItems)
    .where(
      inArray(
        storageDeletionItems.requestId,
        requests.map((request) => BigInt(request.id)),
      ),
    );

  if (items.length === 0) return refuse("delete_requested");

  return verdictForItems(items);
}

/**
 * Is it currently okay to serve this physical file?
 *
 * For /api/files/[id], which is keyed on file_uploads.id and never sees a
 * documentId at all, so checkDocumentServable can't be used there. Both
 * manifest-backed and legacy-promoted items carry the same (adapter, key)
 * pair, so looking items up by ref covers both paths — the same source of
 * truth reached by a different key.
 *
 * Refuses if ANY of the supplied candidate refs is gated: a route may know
 * more than one way to name the same file (a database-adapter id AND an
 * external storage URL), and being gated under either is disqualifying.
 */
export async function checkRefServable(
  refs: Array<{ adapter: string; key: string }>,
): Promise<ServableVerdict> {
  for (const ref of refs) {
    const items = await db
      .select()
      .from(storageDeletionItems)
      .where(
        and(
          eq(storageDeletionItems.adapter, ref.adapter as StorageDeletionItem["adapter"]),
          eq(storageDeletionItems.key, ref.key),
        ),
      );

    const verdict = await verdictForItems(items);
    if (!verdict.servable) return verdict;
  }

  return SERVABLE;
}

// Throwing variants, for callers that would rather not thread a verdict
// through (the design doc names this shape: assertDocumentServable(docId)).
// Next.js route handlers use the check* form instead, since returning a
// response reads better there than try/catch around every read.

export async function assertDocumentServable(docId: number): Promise<void> {
  const verdict = await checkDocumentServable(docId);
  if (!verdict.servable) throw new DocumentNotServableError(verdict);
}

export async function assertVersionServable(params: {
  documentId: number;
  versionId: number;
}): Promise<void> {
  const verdict = await checkVersionServable(params);
  if (!verdict.servable) throw new DocumentNotServableError(verdict);
}

export async function assertRefServable(
  refs: Array<{ adapter: string; key: string }>,
): Promise<void> {
  const verdict = await checkRefServable(refs);
  if (!verdict.servable) throw new DocumentNotServableError(verdict);
}
