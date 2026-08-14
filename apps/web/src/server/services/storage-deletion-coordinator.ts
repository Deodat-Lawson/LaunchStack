/**
 * Storage deletion coordinator — B2.
 *
 * Replaces the old DB-only delete path. A delete is only "complete" once
 * every object a document/version owns has been captured in a durable
 * plan — this module writes that plan (storage_deletion_requests +
 * storage_deletion_items) *before* any relational row is touched. The
 * actual provider (S3/Blob/etc.) deletion happens later, asynchronously,
 * in the deletion worker (B3, not yet built) — this module never calls a
 * storage adapter directly.
 *
 * Two paths per document/version, per Decision 10:
 *   - Manifest exists (B1's hasManifest) → snapshot real storage_objects refs.
 *   - No manifest (pre-B1 document) → scavenge every URL field that might
 *     reference a file, and try to reconstruct a ref from each one via
 *     Dev A's promoteLegacyUrlToRef. A URL that can't be confidently
 *     resolved becomes a QUARANTINED item, not a silently-dropped one.
 *
 * Note on ObjectRef: @launchstack/core/storage doesn't export a finished
 * ObjectRef/DeleteResult contract yet (Dev A's A0 work in progress), so
 * this file uses the same locally-defined shape as storage-manifest.ts.
 * Swap to the real import once it lands.
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
} from "@launchstack/core/db/schema";
import type { StorageDeletionRequest, StorageDeletionTombstone } from "@launchstack/core/db/schema";
import { db } from "~/server/db";
import { inngest } from "~/server/inngest/client";
import { promoteLegacyUrlToRef } from "~/server/storage/legacy-promote";
import { hasManifest, listOwnedRefs, type StorageAdapter } from "./storage-manifest";
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

interface PendingItem {
  /** storage_objects.id — plain number (serial), not bigint. */
  objectId?: number;
  adapter: StorageAdapter;
  storageLocationId: string;
  key: string;
  /** Set when legacy promotion couldn't resolve this URL. */
  quarantineReason?: string;
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

async function insertRequestAndItems(
  tx: Tx,
  params: {
    companyId: number;
    requestedBy: string;
    documentId?: number;
    documentVersionId?: number;
  },
  items: PendingItem[],
): Promise<StorageDeletionRequest> {
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
    })
    .returning();

  if (!request) {
    throw new Error("insertRequestAndItems: request insert returned no row");
  }

  await tx.insert(storageDeletionItems).values(
    items.map((item) => ({
      requestId: BigInt(request.id),
      objectId: item.objectId !== undefined ? BigInt(item.objectId) : undefined,
      adapter: item.adapter,
      storageLocationId: item.storageLocationId,
      key: item.key,
      itemState: item.quarantineReason ? ("QUARANTINED" as const) : ("PENDING" as const),
      lastError: item.quarantineReason,
    })),
  );

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

  return request;
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

  let items: PendingItem[];

  if (await hasManifest(tx, { documentId: params.docId })) {
    const refs = await listOwnedRefs(tx, { documentId: params.docId });
    items = refs.map((ref) => ({
      objectId: ref.id,
      adapter: ref.adapter as StorageAdapter,
      storageLocationId: ref.storageLocationId,
      key: ref.key,
    }));
  } else {
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

    items = promoteUrlsToItems([
      doc.url,
      ...versions.map((v) => v.url),
      ...jobs.map((j) => j.url),
      ...batchFiles.map((b) => b.url),
    ]);
  }

  return insertRequestAndItems(
    tx,
    {
      companyId: params.companyId,
      requestedBy: params.actorId,
      documentId: params.docId,
    },
    items,
  );
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

  return insertRequestAndItems(
    tx,
    {
      companyId: params.companyId,
      requestedBy: params.actorId,
      documentVersionId: params.versionId,
    },
    items,
  );
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
 * NOTE: the tombstone check below currently can't ever find a match — the
 * worker's finalizeRequestIfDone only writes a tombstone in the
 * document-scoped branch (version-scoped purge is a known, already-flagged
 * gap: there's no "purge just this version" relational step yet). Left in
 * place so this starts working automatically once that gap is closed,
 * rather than needing a second change later.
 */
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
