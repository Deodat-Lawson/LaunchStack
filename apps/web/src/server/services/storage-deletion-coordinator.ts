/**
 * Storage deletion coordinator — B2.
 *
 * Writes durable deletion plans (storage_deletion_requests +
 * storage_deletion_items) before any relational row is touched or any
 * storage adapter is called. Provider deletion is handled asynchronously
 * by the deletion worker (B3).
 *
 * Two paths per document/version, per Decision 10:
 *   - Manifest exists → snapshot real storage_objects refs.
 *   - No manifest → promote legacy URLs via promoteLegacyUrlToRef; unresolvable
 *     URLs become QUARANTINED items.
 */

import { and, eq, inArray } from "drizzle-orm";
import {
  document,
  documentVersions,
  ocrJobs,
  uploadBatchFiles,
  storageDeletionRequests,
  storageDeletionItems,
  storageDeletionTombstones,
  storageObjects,
  storageArtifactEdges,
} from "@launchstack/core/db/schema";
import type {
  StorageDeletionItem,
  StorageDeletionRequest,
  StorageDeletionTombstone,
} from "@launchstack/core/db/schema";
import { db } from "~/server/db";
import { inngest } from "~/server/inngest/client";
import { promoteLegacyUrlToRef } from "~/server/storage/legacy-promote";
import {
  hasDocumentManifest,
  hasManifest,
  listDocumentOwnedRefs,
  listOwnedRefs,
  type StorageAdapter,
} from "./storage-manifest";
import { deleteDocumentCore } from "./document-delete";

type Tx = Parameters<Parameters<(typeof db)["transaction"]>[0]>[0];

// Typed errors instead of generic Error + string-matching on the message —
// matching on substrings of an error's text is fragile (an unrelated error
// containing the words "not found" would be silently misclassified). API
// callers (delete-document-api.ts) should check `instanceof`, not text.
export class DocumentNotFoundError extends Error {}
export class VersionNotFoundError extends Error {}
export class TenantMismatchError extends Error {}
/** Thrown when the plan was written but the worker couldn't be notified. */
export class DispatchFailedError extends Error {}

export class ObjectCleanupRefusedError extends Error {}

export type DeletionRequestIntent = "document_purge" | "version_purge" | "object_cleanup";
interface PendingItem {
  /** storage_objects.id — plain number (serial), not bigint. */
  objectId?: number;
  adapter: StorageAdapter;
  storageLocationId: string;
  key: string;
  /** Set when legacy promotion couldn't resolve this URL. */
  quarantineReason?: string;
  /**
   * Cross-document dedup (B5): storage_deletion_items.id of the "leader"
   * item that will actually perform this file's delete. Set only by the
   * batch coordinator, and only on legacy-promoted items. An item carrying
   * this is inserted as LINKED and is never independently processed — its
   * real outcome is read from (and eventually materialized off of) the
   * leader.
   */
  linkedToItemId?: number;
}

/**
 * Identity of a physical file, for cross-document dedup. Joins the ref
 * triple with a NUL separator, which can't appear in a URL, an S3 key or a
 * bucket name — so two different triples can never collide into one string
 * (a plain ":" join could, e.g. key "a:b" vs location "a" + key "b").
 */
export function refIdentity(item: {
  adapter: string;
  storageLocationId: string;
  key: string;
}): string {
  return `${item.adapter}\u0000${item.storageLocationId}\u0000${item.key}`;
}

/**
 * Try to promote a set of raw URLs (deduped) into deletion items, via
 * Dev A's promoteLegacyUrlToRef. Never silently drops a URL — an
 * unresolvable one still becomes an item, just a QUARANTINED one.
 */
function promoteUrlsToItems(urls: Iterable<string | null | undefined>): PendingItem[] {
  const unique = new Set<string>();
  for (const url of urls) {
    if (url) unique.add(url);
  }

  const items: PendingItem[] = [];
  for (const url of unique) {
    const promoted = promoteLegacyUrlToRef({ value: url });
    if (promoted.ok) {
      items.push({
        adapter: promoted.ref.adapter as StorageAdapter,
        storageLocationId: promoted.ref.storageLocationId,
        key: promoted.ref.key,
      });
    } else {
      items.push({
        adapter: "database", // placeholder — unresolved, never used for a real delete call
        storageLocationId: "unresolved",
        key: url,
        quarantineReason: promoted.reason,
      });
    }
  }
  return items;
}

/** Overall request status implied by the items it's starting with. */
function initialStatus(items: PendingItem[]): "queued" | "quarantined" {
  return items.some((i) => i.quarantineReason) ? "quarantined" : "queued";
}

/** What insertRequestAndItems actually wrote — the request plus its rows. */
export interface InsertedRequest {
  request: StorageDeletionRequest;
  items: StorageDeletionItem[];
}

async function insertRequestAndItems(
  tx: Tx,
  params: {
    companyId: number;
    requestedBy: string;
    documentId?: number;
    documentVersionId?: number;
    intent?: DeletionRequestIntent;
  },
  items: PendingItem[],
): Promise<InsertedRequest> {
  if (items.length === 0) {
    // Should be unreachable — document.url is NOT NULL, so there's always
    // at least one candidate URL. Fail loud rather than silently proceeding
    // to a purge with an empty plan.
    throw new Error(
      "insertRequestAndItems: refusing to create a deletion request with zero items",
    );
  }

  const [request] = await tx
    .insert(storageDeletionRequests)
    .values({
      companyId: BigInt(params.companyId),
      documentId: params.documentId !== undefined ? BigInt(params.documentId) : undefined,
      documentVersionId:
        params.documentVersionId !== undefined
          ? BigInt(params.documentVersionId)
          : undefined,
      requestedBy: params.requestedBy,
      status: initialStatus(items),
      intent: params.intent ?? "document_purge",
    })
    .returning();

  if (!request) {
    throw new Error("insertRequestAndItems: request insert returned no row");
  }

  const insertedItems = await tx
    .insert(storageDeletionItems)
    .values(
      items.map((item) => ({
        requestId: BigInt(request.id),
        objectId: item.objectId !== undefined ? BigInt(item.objectId) : undefined,
        adapter: item.adapter,
        storageLocationId: item.storageLocationId,
        key: item.key,
        linkedToItemId:
          item.linkedToItemId !== undefined ? BigInt(item.linkedToItemId) : undefined,
        // Order matters: a quarantined item is quarantined regardless (it was
        // never a resolvable ref, so it can't be following anything), and a
        // follower is LINKED. Everything else starts PENDING.
        itemState: item.quarantineReason
          ? ("QUARANTINED" as const)
          : item.linkedToItemId !== undefined
            ? ("LINKED" as const)
            : ("PENDING" as const),
        lastError: item.quarantineReason,
      })),
    )
    .returning();

  // Flip every manifest-backed object to DELETE_REQUESTED, in the same
  // transaction. Legacy-promoted items (no objectId) have no storage_objects
  // row to update — they only exist as items.
  const manifestObjectIds = items
    .map((item) => item.objectId)
    .filter((id): id is number => id !== undefined);

  if (manifestObjectIds.length > 0) {
    await tx
      .update(storageObjects)
      .set({ lifecycleState: "DELETE_REQUESTED" })
      .where(inArray(storageObjects.id, manifestObjectIds));
  }

  return { request, items: insertedItems };
}

/**
 * Authorize + lock a document, then resolve the full list of objects that
 * deleting it must clean up — WITHOUT writing anything.
 *
 * Split out of requestDocumentDeletion for B5: the batch coordinator has to
 * see every document's item list *before* inserting any of them, so it can
 * spot the same physical file appearing under two documents and elect one
 * leader for it. Single-document behavior is unchanged — requestDocumentDeletion
 * is now just this function followed by the same insert as before.
 */
export async function buildDocumentDeletionItems(
  tx: Tx,
  params: { docId: number; companyId: number },
): Promise<PendingItem[]> {
  // Authorize + lock. Row lock prevents a second concurrent delete request
  // for the same document from racing this one.
  const [doc] = await tx
    .select()
    .from(document)
    .where(eq(document.id, params.docId))
    .for("update");

  if (!doc) {
    throw new DocumentNotFoundError(`requestDocumentDeletion: document ${params.docId} not found`);
  }
  if (doc.companyId !== BigInt(params.companyId)) {
    throw new TenantMismatchError(
      `requestDocumentDeletion: document ${params.docId} does not belong to company ${params.companyId}`,
    );
  }

  if (await hasDocumentManifest(tx, params.docId)) {
    const refs = await listDocumentOwnedRefs(tx, params.docId);
    return refs.map((ref) => ({
      objectId: ref.id,
      adapter: ref.adapter as StorageAdapter,
      storageLocationId: ref.storageLocationId,
      key: ref.key,
    }));
  }

  // No manifest — scavenge every URL field that might reference a file.
  const versions = await tx
    .select({ url: documentVersions.url })
    .from(documentVersions)
    .where(eq(documentVersions.documentId, BigInt(params.docId)));
  const jobs = await tx
    .select({ url: ocrJobs.documentUrl })
    .from(ocrJobs)
    .where(eq(ocrJobs.documentId, BigInt(params.docId)));
  const batchFiles = await tx
    .select({ url: uploadBatchFiles.storageUrl })
    .from(uploadBatchFiles)
    .where(eq(uploadBatchFiles.documentId, BigInt(params.docId)));

  return promoteUrlsToItems([
    doc.url,
    ...versions.map((v) => v.url),
    ...jobs.map((j) => j.url),
    ...batchFiles.map((b) => b.url),
  ]);
}

/**
 * Request deletion of an entire document — all versions, all owned
 * objects. Commits the durable plan; does not touch storage or purge
 * relational rows itself (that's the worker's job, later, once every item
 * is confirmed clean).
 */
export async function requestDocumentDeletion(
  tx: Tx,
  params: { docId: number; companyId: number; actorId: string },
): Promise<StorageDeletionRequest> {
  const items = await buildDocumentDeletionItems(tx, {
    docId: params.docId,
    companyId: params.companyId,
  });

  const { request } = await insertRequestAndItems(
    tx,
    {
      companyId: params.companyId,
      requestedBy: params.actorId,
      documentId: params.docId,
    },
    items,
  );

  return request;
}

/**
 * Request deletion of a single document version. Same manifest/legacy
 * branching as requestDocumentDeletion, scoped to just this version's
 * owned refs (or just its own URL, in the legacy-fallback case).
 */
export async function requestVersionDeletion(
  tx: Tx,
  params: { versionId: number; companyId: number; actorId: string },
): Promise<StorageDeletionRequest> {
  const [version] = await tx
    .select()
    .from(documentVersions)
    .where(eq(documentVersions.id, params.versionId))
    .for("update");

  if (!version) {
    throw new VersionNotFoundError(`requestVersionDeletion: version ${params.versionId} not found`);
  }

  // documentVersions has no companyId of its own — authorize via its parent
  // document, same check requestDocumentDeletion does.
  const [parentDoc] = await tx
    .select({ companyId: document.companyId })
    .from(document)
    .where(eq(document.id, Number(version.documentId)));

  if (!parentDoc) {
    throw new DocumentNotFoundError(
      `requestVersionDeletion: parent document for version ${params.versionId} not found`,
    );
  }
  if (parentDoc.companyId !== BigInt(params.companyId)) {
    throw new TenantMismatchError(
      `requestVersionDeletion: version ${params.versionId} does not belong to company ${params.companyId}`,
    );
  }

  let items: PendingItem[];

  if (await hasManifest(tx, { documentVersionId: params.versionId })) {
    const refs = await listOwnedRefs(tx, { documentVersionId: params.versionId });
    items = refs.map((ref) => ({
      objectId: ref.id,
      adapter: ref.adapter as StorageAdapter,
      storageLocationId: ref.storageLocationId,
      key: ref.key,
    }));
  } else {
    items = promoteUrlsToItems([version.url]);
  }

  const { request } = await insertRequestAndItems(
    tx,
    {
      companyId: params.companyId,
      requestedBy: params.actorId,
      documentVersionId: params.versionId,
      intent: "version_purge",
    },
    items,
  );

  return request;
}

/**
 * Hard-delete the relational rows for a document. Only call this once
 * every required deletion item is DELETED or NOT_FOUND (the worker's job,
 * B3, not this function's) — this is the "existing ordered deletes" logic,
 * reused as-is from the pre-existing deleteDocumentCore.
 */
export async function purgeDocumentRelational(tx: Tx, docId: number): Promise<void> {
  await deleteDocumentCore(tx, docId);
}

export class CancellationRefusedError extends Error {}

/**
 * Cancel a deletion request, but only while it's genuinely safe to —
 * before the worker has actually started deleting anything. Per the design
 * doc: "DELETE_REQUESTED -> CANCELLED only before any provider call
 * starts; refused once STORAGE_DELETING begins."
 *
 * Known limitation: this only cancels manifest-backed items (the ones with
 * a real storage_objects row, whose lifecycleState the worker checks
 * before touching a file). Legacy-promoted items (no objectId — see
 * promoteUrlsToItems) have no per-object state to flip, so there's no way
 * for this function to individually stop those from being processed. In
 * practice a request is almost always all-manifest or all-legacy, so this
 * is a real but narrow gap, not a silent no-op.
 */
export async function cancelDeletionRequest(
  requestId: number,
  actorId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [request] = await tx
      .select()
      .from(storageDeletionRequests)
      .where(eq(storageDeletionRequests.id, requestId))
      .for("update");

    if (!request) {
      throw new Error(`cancelDeletionRequest: request ${requestId} not found`);
    }

    const items = await tx
      .select()
      .from(storageDeletionItems)
      .where(eq(storageDeletionItems.requestId, BigInt(requestId)));

    const objectIds = items
      .map((item) => item.objectId)
      .filter((id): id is bigint => id !== null)
      .map((id) => Number(id));

    if (objectIds.length > 0) {
      const objects = await tx
        .select()
        .from(storageObjects)
        .where(inArray(storageObjects.id, objectIds));

      const alreadyStarted = objects.some(
        (obj) => obj.lifecycleState !== "DELETE_REQUESTED",
      );
      if (alreadyStarted) {
        throw new CancellationRefusedError(
          `cancelDeletionRequest: request ${requestId} has already started deleting (an object is past DELETE_REQUESTED) — refusing to cancel`,
        );
      }

      await tx
        .update(storageObjects)
        .set({ lifecycleState: "CANCELLED" })
        .where(inArray(storageObjects.id, objectIds));
    }

    // No "cancelled" value exists in the requests/items status enums
    // (Decision 6 only defines queued/completed/partial/manual_review/
    // quarantined for requests) — cancellation lives entirely at the
    // storage_objects level. The worker skips any item whose object is
    // CANCELLED, so the request just never completes; that's the intended
    // behavior, not an oversight.
    console.log(
      `[cancelDeletionRequest] request=${requestId} cancelled by actor=${actorId} at ${new Date().toISOString()}`,
    );
  });
}

/**
 * Public entry point for routes (B4/B5): opens its own transaction, writes
 * the deletion plan via requestDocumentDeletion, and — only once that
 * transaction has actually committed — tells the B3 worker to start
 * processing it. Matches the existing pattern elsewhere in this codebase
 * (see api/trend-search/route.ts, api/updateCompany/route.ts): the
 * transaction and the inngest.send are deliberately two separate steps, so
 * we never fire an event for a request that got rolled back.
 */
export type DeletionDispatchResult =
  | { kind: "created"; request: StorageDeletionRequest }
  | { kind: "already-completed"; tombstone: StorageDeletionTombstone };

/**
 * Used only when inngest.send fails right after a request was written:
 * undoes both the request/items rows AND the storage_objects.lifecycleState
 * flip to DELETE_REQUESTED that insertRequestAndItems already made — since
 * nothing will ever process this request, leaving those objects stuck at
 * DELETE_REQUESTED with no live request behind them would be its own bug.
 * Only reverts objects still at DELETE_REQUESTED (a guard, not expected to
 * matter in practice — nothing else touches an object before the worker is
 * ever notified).
 */
async function rollbackFailedDispatch(requestId: number): Promise<void> {
  await db.transaction(async (tx) => {
    const items = await tx
      .select()
      .from(storageDeletionItems)
      .where(eq(storageDeletionItems.requestId, BigInt(requestId)));

    const objectIds = items
      .map((item) => item.objectId)
      .filter((id): id is bigint => id !== null)
      .map((id) => Number(id));

    if (objectIds.length > 0) {
      await tx
        .update(storageObjects)
        .set({ lifecycleState: "ACTIVE" })
        .where(
          and(
            inArray(storageObjects.id, objectIds),
            eq(storageObjects.lifecycleState, "DELETE_REQUESTED"),
          ),
        );
    }

    await tx.delete(storageDeletionRequests).where(eq(storageDeletionRequests.id, requestId));
  });
}

export async function requestDocumentDeletionAndDispatch(params: {
  docId: number;
  companyId: number;
  actorId: string;
}): Promise<DeletionDispatchResult> {
  // Idempotent re-delete (design doc B3 item 8): a second delete request
  // against an already-purged document returns the existing tombstone's
  // status rather than inventing a new request — there's nothing left to
  // delete, the document row is already gone.
  const [existingTombstone] = await db
    .select()
    .from(storageDeletionTombstones)
    .where(eq(storageDeletionTombstones.documentId, BigInt(params.docId)));

  if (existingTombstone) {
    return { kind: "already-completed", tombstone: existingTombstone };
  }

  const request = await db.transaction(async (tx) => {
    return requestDocumentDeletion(tx, params);
  });

  try {
    await inngest.send({
      name: "storage-deletion/request.created",
      data: { requestId: request.id },
    });
  } catch (err) {
    // Hard failure, by design: if we can't tell the worker to start, this
    // whole operation did not succeed — we don't leave a "queued" request
    // behind that nothing will ever process. Undo the write (request,
    // items, and any DELETE_REQUESTED objects it touched) and surface a
    // clear error rather than a misleading partial success.
    await rollbackFailedDispatch(request.id);
    throw new DispatchFailedError(
      `requestDocumentDeletionAndDispatch: request ${request.id} was written but the worker could not be notified — rolled back. Underlying error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return { kind: "created", request };
}

/**
 * Same idea as requestDocumentDeletionAndDispatch, for a single version.
 * Idempotent re-delete is supported the same way as documents: when a
 * prior request has already completed and purged the version row, the
 * persisted tombstone is returned instead of creating a new request.
 */
// ---------------------------------------------------------------------------
// B5 — batch delete
// ---------------------------------------------------------------------------

/** One document's slot in a batch delete plan. */
export interface BatchDeletionEntry {
  docId: number;
  request: StorageDeletionRequest;
  itemCount: number;
  /**
   * How many of this document's items are followers — i.e. reference a file
   * that an earlier document in the same batch already claimed. 0 for the
   * overwhelming majority of batches.
   */
  linkedItemCount: number;
}

/**
 * Write deletion plans for N documents in ONE transaction, deduping any
 * physical file that more than one of them references.
 *
 * Why dedup is needed at all: manifest-backed objects are exclusively owned
 * by exactly one document (storage_objects' exactly-one-owner CHECK), so two
 * documents can never both own the same manifest row. But a pre-manifest
 * document's refs are scavenged from raw URL columns, and two documents can
 * genuinely carry the same URL — which without dedup would mean two
 * independent delete calls for one file.
 *
 * How it's resolved: the first document to reference a file becomes its
 * "leader" and gets an ordinary PENDING item. Every later document
 * referencing the same file gets a follower — a real item row carrying the
 * same adapter/location/key (so its audit trail is complete), but in state
 * LINKED with linkedToItemId pointing at the leader's item. The worker's
 * itemsToProcess filter is a PENDING/WAITING_RETRY allowlist, so a follower
 * is never independently processed: exactly one provider call per file.
 *
 * Not deduped, deliberately:
 *   - manifest-backed items — can't collide (see above), and making one a
 *     follower would strand its storage_objects row at DELETE_REQUESTED with
 *     nothing to advance it.
 *   - quarantined items — an unresolvable URL isn't a resolved ref at all,
 *     and each document needs its own QUARANTINED item so its own request
 *     status is independently correct.
 *   - duplicates *within* a single document — unchanged from the
 *     single-document path, which already relies on delete idempotency there.
 *
 * Any failure (missing doc, wrong tenant) throws and rolls back the whole
 * batch — "one txn accepts durable intent for all IDs" means all or nothing.
 */
export async function requestBatchDocumentDeletion(
  tx: Tx,
  params: { docIds: number[]; companyId: number; actorId: string },
): Promise<BatchDeletionEntry[]> {
  // Sorted ascending for two reasons: leader election becomes deterministic
  // (the lowest doc id in the batch owns any file it shares, so a retry of
  // the same batch produces the same plan), and every batch takes its
  // document row locks in the same order, which is what stops two
  // overlapping batches from deadlocking against each other.
  const uniqueDocIds = Array.from(new Set(params.docIds)).sort((a, b) => a - b);

  /** refIdentity -> storage_deletion_items.id of the item that owns that file. */
  const claimed = new Map<string, number>();
  const entries: BatchDeletionEntry[] = [];

  for (const docId of uniqueDocIds) {
    const built = await buildDocumentDeletionItems(tx, {
      docId,
      companyId: params.companyId,
    });

    let linkedItemCount = 0;
    const items = built.map((item) => {
      if (item.objectId !== undefined || item.quarantineReason) return item;

      const leaderItemId = claimed.get(refIdentity(item));
      if (leaderItemId === undefined) return item;

      linkedItemCount += 1;
      return { ...item, linkedToItemId: leaderItemId };
    });

    // Inserted per document, in order, because a follower needs its leader's
    // real DB-assigned id to already exist.
    const { request, items: inserted } = await insertRequestAndItems(
      tx,
      {
        companyId: params.companyId,
        requestedBy: params.actorId,
        documentId: docId,
      },
      items,
    );

    // Claim this document's newly-inserted leaders for the documents that
    // come after it. Only PENDING legacy items are claimable: a follower
    // can't be a leader, and a QUARANTINED item never resolved to a real ref.
    for (const row of inserted) {
      if (row.objectId !== null) continue;
      if (row.itemState !== "PENDING") continue;
      const identity = refIdentity(row);
      if (!claimed.has(identity)) claimed.set(identity, row.id);
    }

    entries.push({ docId, request, itemCount: inserted.length, linkedItemCount });
  }

  return entries;
}

/** Per-document outcome of a dispatched batch delete. */
export type BatchDeletionDispatchEntry =
  | {
      docId: number;
      kind: "created";
      request: StorageDeletionRequest;
      itemCount: number;
      linkedItemCount: number;
    }
  | { docId: number; kind: "already-completed"; tombstone: StorageDeletionTombstone };

/**
 * Public entry point for the B5 route. Same shape as
 * requestDocumentDeletionAndDispatch, extended across N documents:
 *
 *   - Documents that already have a tombstone are answered from it and never
 *     re-planned (idempotent re-delete, per-document).
 *   - Everything else is planned in a single transaction.
 *   - The worker is notified with ONE inngest.send carrying every request, so
 *     dispatch is all-or-nothing. Anything else risks a batch where some
 *     documents got picked up and others silently never will — and since a
 *     follower depends on a leader in a *different* request, a half-dispatched
 *     batch could strand followers permanently.
 *   - If that send fails, every request written by this batch is rolled back
 *     (same hard-failure rule as the single-document path) and
 *     DispatchFailedError is thrown.
 */
export async function requestBatchDocumentDeletionAndDispatch(params: {
  docIds: number[];
  companyId: number;
  actorId: string;
}): Promise<BatchDeletionDispatchEntry[]> {
  const uniqueDocIds = Array.from(new Set(params.docIds)).sort((a, b) => a - b);
  if (uniqueDocIds.length === 0) return [];

  const tombstones = await db
    .select()
    .from(storageDeletionTombstones)
    .where(
      inArray(
        storageDeletionTombstones.documentId,
        uniqueDocIds.map((id) => BigInt(id)),
      ),
    );

  const tombstoneByDocId = new Map<number, StorageDeletionTombstone>();
  for (const tombstone of tombstones) {
    if (tombstone.documentId !== null) {
      tombstoneByDocId.set(Number(tombstone.documentId), tombstone);
    }
  }

  const toPlan = uniqueDocIds.filter((id) => !tombstoneByDocId.has(id));

  const results: BatchDeletionDispatchEntry[] = uniqueDocIds
    .filter((id) => tombstoneByDocId.has(id))
    .map((id) => ({
      docId: id,
      kind: "already-completed" as const,
      tombstone: tombstoneByDocId.get(id)!,
    }));

  if (toPlan.length === 0) return results;

  const planned = await db.transaction(async (tx) =>
    requestBatchDocumentDeletion(tx, {
      docIds: toPlan,
      companyId: params.companyId,
      actorId: params.actorId,
    }),
  );

  try {
    await inngest.send(
      planned.map((entry) => ({
        name: "storage-deletion/request.created",
        data: { requestId: entry.request.id },
      })),
    );
  } catch (err) {
    for (const entry of planned) {
      await rollbackFailedDispatch(entry.request.id);
    }
    throw new DispatchFailedError(
      `requestBatchDocumentDeletionAndDispatch: ${planned.length} request(s) were written but the worker could not be notified — all rolled back. Underlying error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  for (const entry of planned) {
    results.push({
      docId: entry.docId,
      kind: "created",
      request: entry.request,
      itemCount: entry.itemCount,
      linkedItemCount: entry.linkedItemCount,
    });
  }

  results.sort((a, b) => a.docId - b.docId);
  return results;
}

export async function requestVersionDeletionAndDispatch(params: {
  versionId: number;
  companyId: number;
  actorId: string;
}): Promise<DeletionDispatchResult> {
  const [existingTombstone] = await db
    .select()
    .from(storageDeletionTombstones)
    .where(eq(storageDeletionTombstones.documentVersionId, BigInt(params.versionId)));

  if (existingTombstone) {
    return { kind: "already-completed", tombstone: existingTombstone };
  }

  const request = await db.transaction(async (tx) => {
    return requestVersionDeletion(tx, params);
  });

  try {
    await inngest.send({
      name: "storage-deletion/request.created",
      data: { requestId: request.id },
    });
  } catch (err) {
    await rollbackFailedDispatch(request.id);
    throw new DispatchFailedError(
      `requestVersionDeletionAndDispatch: request ${request.id} was written but the worker could not be notified — rolled back. Underlying error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return { kind: "created", request };
}

/**
 * Request deletion of specific manifest object(s) without purging the
 * document or triggering serve-gating. Used when a document replaces its
 * bytes (e.g. DOCX edit) and the superseded blob should be cleaned up.
 */
export async function requestObjectCleanup(
  tx: Tx,
  params: {
    companyId: number;
    actorId: string;
    documentId: number;
    objectIds: number[];
  },
): Promise<StorageDeletionRequest> {
  const uniqueObjectIds = Array.from(new Set(params.objectIds));
  if (uniqueObjectIds.length === 0) {
    throw new Error("requestObjectCleanup: objectIds must not be empty");
  }

  const [doc] = await tx
    .select({ companyId: document.companyId })
    .from(document)
    .where(eq(document.id, params.documentId));

  if (!doc) {
    throw new DocumentNotFoundError(
      `requestObjectCleanup: document ${params.documentId} not found`,
    );
  }
  if (doc.companyId !== BigInt(params.companyId)) {
    throw new TenantMismatchError(
      `requestObjectCleanup: document ${params.documentId} does not belong to company ${params.companyId}`,
    );
  }

  const objects = await tx
    .select()
    .from(storageObjects)
    .where(inArray(storageObjects.id, uniqueObjectIds));

  if (objects.length !== uniqueObjectIds.length) {
    throw new ObjectCleanupRefusedError(
      "requestObjectCleanup: one or more object ids were not found",
    );
  }

  for (const obj of objects) {
    if (obj.companyId !== BigInt(params.companyId)) {
      throw new TenantMismatchError(
        `requestObjectCleanup: object ${obj.id} does not belong to company ${params.companyId}`,
      );
    }

    const ownedByDocument =
      obj.documentId !== null && obj.documentId === BigInt(params.documentId);

    if (ownedByDocument) continue;

    const [supersedesEdge] = await tx
      .select({ parentObjectId: storageArtifactEdges.parentObjectId })
      .from(storageArtifactEdges)
      .where(
        and(
          eq(storageArtifactEdges.childObjectId, BigInt(obj.id)),
          eq(storageArtifactEdges.edgeType, "supersedes"),
        ),
      );

    if (!supersedesEdge) {
      throw new ObjectCleanupRefusedError(
        `requestObjectCleanup: object ${obj.id} is not owned by document ${params.documentId} and has no supersedes edge`,
      );
    }

    const [parent] = await tx
      .select({ documentId: storageObjects.documentId })
      .from(storageObjects)
      .where(eq(storageObjects.id, Number(supersedesEdge.parentObjectId)));

    if (
      !parent ||
      parent.documentId === null ||
      parent.documentId !== BigInt(params.documentId)
    ) {
      throw new ObjectCleanupRefusedError(
        `requestObjectCleanup: object ${obj.id} supersedes edge does not trace to document ${params.documentId}`,
      );
    }
  }

  const items: PendingItem[] = objects.map((obj) => ({
    objectId: obj.id,
    adapter: obj.adapter as StorageAdapter,
    storageLocationId: obj.storageLocationId,
    key: obj.key,
  }));

  const { request } = await insertRequestAndItems(
    tx,
    {
      companyId: params.companyId,
      requestedBy: params.actorId,
      documentId: params.documentId,
      intent: "object_cleanup",
    },
    items,
  );

  return request;
}

export async function requestObjectCleanupAndDispatch(params: {
  companyId: number;
  actorId: string;
  documentId: number;
  objectIds: number[];
}): Promise<DeletionDispatchResult> {
  const request = await db.transaction(async (tx) => requestObjectCleanup(tx, params));

  try {
    await inngest.send({
      name: "storage-deletion/request.created",
      data: { requestId: request.id },
    });
  } catch (err) {
    await rollbackFailedDispatch(request.id);
    throw new DispatchFailedError(
      `requestObjectCleanupAndDispatch: request ${request.id} was written but the worker could not be notified — rolled back. Underlying error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return { kind: "created", request };
}
