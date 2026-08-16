/**
 * Deletion status read API — B7.
 *
 * The "let a human check what's going on" piece. B3 marks an item BLOCKED
 * after 5 failed attempts and leaves it "for a human to look at (future B7
 * status API)" — until now the only way to answer that was to open the
 * database. This module makes it answerable over HTTP.
 *
 * Strictly read-only. Nothing here writes, including the LINKED-item
 * resolution below, which deliberately does NOT persist the BLOCKED fallback
 * the worker's equivalent does — a GET must not mutate.
 *
 * WHY STATUS IS COMPUTED, NOT READ
 * --------------------------------
 * storage_deletion_requests.status is a maintained summary column, but the
 * worker only ever writes quarantined / manual_review / completed. Nothing
 * wrote "partial" before B7, so simply echoing the stored column could never
 * produce the one status the design doc singles out for per-item detail. So
 * this module derives status from the items, and reports the stored value
 * alongside it as `storedStatus` — if the two ever disagree, that disagreement
 * is itself the useful signal.
 *
 * (finalizeRequestIfDone now persists "partial" too, so in practice they
 * should agree. Keeping both visible makes a drifting summary column
 * detectable rather than silently wrong.)
 *
 * TWO LOOKUPS, BOTH DURABLE
 * -------------------------
 * By request id and by document id. Both keep working after the deletion
 * completes and the request/items rows are cascaded away: the tombstone
 * carries document_id, and — as of migration 0022 — retains request_id too.
 */

import { desc, eq } from "drizzle-orm";
import {
  document,
  storageDeletionItems,
  storageDeletionRequests,
  storageDeletionTombstones,
  storageObjects,
} from "@launchstack/core/db/schema";
import type { StorageDeletionItem } from "@launchstack/core/db/schema";

import { db } from "~/server/db";

/** The frozen deletion status enum. B7 reports these, it never invents one. */
export type DeletionStatus =
  | "queued"
  | "completed"
  | "partial"
  | "manual_review"
  | "quarantined";

const TERMINAL_ITEM_STATES = new Set(["DELETED", "NOT_FOUND"]);

export interface DeletionStatusItem {
  itemId: number;
  adapter: string;
  storageLocationId: string;
  key: string;
  /** The row's own state — "LINKED" for a B5 follower. */
  state: string;
  /** What that state actually means once a LINKED item is resolved. */
  effectiveState: string;
  /** Set when this item follows another document's leader item (B5 dedup). */
  linkedToItemId?: number;
  /** Present only for manifest-backed items. */
  objectLifecycleState?: string;
  attempts: number;
  lastError?: string;
  /** True when this item is why the request isn't finished. */
  blockingCompletion: boolean;
}

export interface DeletionStatusPayload {
  scope: "request" | "document";
  /** True when answered from a tombstone — the rows themselves are gone. */
  purged: boolean;
  requestId?: number;
  documentId?: number;
  documentVersionId?: number;
  status: DeletionStatus;
  /** The maintained summary column. Absent for tombstone-only answers. */
  storedStatus?: DeletionStatus;
  requestedBy?: string;
  createdAt?: Date;
  completedAt?: Date;
  itemCount: number;
  /** Tally by effective state, e.g. { DELETED: 3, BLOCKED: 1 }. */
  counts: Record<string, number>;
  items: DeletionStatusItem[];
  /**
   * Other live requests for the same document. Normally empty — but a second
   * delete call while one is already in flight does create a second request
   * (the idempotency check only consults tombstones, which don't exist yet at
   * that point), so this surfaces that rather than hiding it.
   */
  otherRequestIds?: number[];
}

export type DeletionStatusResult =
  | { kind: "ok"; payload: DeletionStatusPayload }
  | { kind: "not-found" }
  | { kind: "forbidden" }
  | { kind: "no-deletion"; documentId: number };

/**
 * Collapse effective item states into one frozen-enum status.
 *
 * Severity order, and why:
 *   quarantined    — Decision 6: quarantined dominates manual_review
 *   manual_review  — something is BLOCKED; a human must act
 *   completed      — every item terminal
 *   partial        — some terminal, some not (Decision 6a's rule, one level
 *                    down from the batch: this is the case that needs the
 *                    per-item detail below to be actionable)
 *   queued         — nothing terminal yet
 */
export function computeRequestStatus(effectiveStates: string[]): DeletionStatus {
  if (effectiveStates.length === 0) return "queued";
  if (effectiveStates.includes("QUARANTINED")) return "quarantined";
  if (effectiveStates.includes("BLOCKED")) return "manual_review";

  const terminal = effectiveStates.filter((state) => TERMINAL_ITEM_STATES.has(state)).length;
  if (terminal === effectiveStates.length) return "completed";
  if (terminal > 0) return "partial";
  return "queued";
}

/**
 * Read-only resolution of LINKED (B5 follower) items to their leader's state.
 *
 * Unlike the worker's version, an orphaned follower is reported as BLOCKED
 * here WITHOUT persisting that — the worker owns state transitions, a status
 * read does not.
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

  const leaders: StorageDeletionItem[] = [];
  for (const leaderId of leaderIds) {
    const [leader] = await db
      .select()
      .from(storageDeletionItems)
      .where(eq(storageDeletionItems.id, leaderId));
    if (leader) leaders.push(leader);
  }
  const leaderById = new Map(leaders.map((leader) => [leader.id, leader]));

  for (const item of items) {
    if (item.itemState !== "LINKED") {
      effective.set(item.id, item.itemState);
      continue;
    }
    const leader =
      item.linkedToItemId !== null ? leaderById.get(Number(item.linkedToItemId)) : undefined;
    if (!leader) {
      effective.set(item.id, "BLOCKED");
      continue;
    }
    effective.set(item.id, leader.itemState === "LINKED" ? "WAITING_RETRY" : leader.itemState);
  }

  return effective;
}

async function buildItemDetail(
  items: StorageDeletionItem[],
): Promise<{ detail: DeletionStatusItem[]; counts: Record<string, number> }> {
  const effective = await resolveEffectiveStates(items);

  const objectIds = items
    .map((item) => item.objectId)
    .filter((id): id is bigint => id !== null)
    .map((id) => Number(id));

  const objects: Array<{ id: number; lifecycleState: string }> = [];
  for (const objectId of objectIds) {
    const [obj] = await db.select().from(storageObjects).where(eq(storageObjects.id, objectId));
    if (obj) objects.push({ id: obj.id, lifecycleState: obj.lifecycleState });
  }
  const lifecycleById = new Map(objects.map((obj) => [obj.id, obj.lifecycleState]));

  const counts: Record<string, number> = {};
  const detail = items.map((item) => {
    const effectiveState = effective.get(item.id) ?? item.itemState;
    counts[effectiveState] = (counts[effectiveState] ?? 0) + 1;

    return {
      itemId: item.id,
      adapter: item.adapter,
      storageLocationId: item.storageLocationId,
      key: item.key,
      state: item.itemState,
      effectiveState,
      ...(item.linkedToItemId !== null
        ? { linkedToItemId: Number(item.linkedToItemId) }
        : {}),
      ...(item.objectId !== null && lifecycleById.has(Number(item.objectId))
        ? { objectLifecycleState: lifecycleById.get(Number(item.objectId))! }
        : {}),
      attempts: item.attempts,
      ...(item.lastError ? { lastError: item.lastError } : {}),
      blockingCompletion: !TERMINAL_ITEM_STATES.has(effectiveState),
    } satisfies DeletionStatusItem;
  });

  return { detail, counts };
}

function tombstonePayload(
  scope: "request" | "document",
  tombstone: typeof storageDeletionTombstones.$inferSelect,
): DeletionStatusPayload {
  return {
    scope,
    purged: true,
    ...(tombstone.requestId !== null ? { requestId: Number(tombstone.requestId) } : {}),
    ...(tombstone.documentId !== null ? { documentId: Number(tombstone.documentId) } : {}),
    ...(tombstone.documentVersionId !== null
      ? { documentVersionId: Number(tombstone.documentVersionId) }
      : {}),
    status: tombstone.finalStatus as DeletionStatus,
    createdAt: tombstone.createdAt,
    itemCount: tombstone.objectCount,
    counts: {},
    // The per-item rows were cascaded away with the document. The tombstone
    // is deliberately minimal (see its schema comment) — objectCount is all
    // that survives, and inventing detail here would be fiction.
    items: [],
  };
}

async function livePayload(
  scope: "request" | "document",
  request: typeof storageDeletionRequests.$inferSelect,
  otherRequestIds?: number[],
): Promise<DeletionStatusPayload> {
  const items = await db
    .select()
    .from(storageDeletionItems)
    .where(eq(storageDeletionItems.requestId, BigInt(request.id)));

  const { detail, counts } = await buildItemDetail(items);

  return {
    scope,
    purged: false,
    requestId: request.id,
    ...(request.documentId !== null ? { documentId: Number(request.documentId) } : {}),
    ...(request.documentVersionId !== null
      ? { documentVersionId: Number(request.documentVersionId) }
      : {}),
    status: computeRequestStatus(detail.map((item) => item.effectiveState)),
    storedStatus: request.status as DeletionStatus,
    requestedBy: request.requestedBy,
    createdAt: request.createdAt,
    ...(request.completedAt ? { completedAt: request.completedAt } : {}),
    itemCount: items.length,
    counts,
    items: detail,
    ...(otherRequestIds && otherRequestIds.length > 0 ? { otherRequestIds } : {}),
  };
}

/** Status of one deletion request, live or long-completed. */
export async function getDeletionStatusByRequestId(params: {
  requestId: number;
  companyId: number;
}): Promise<DeletionStatusResult> {
  const [request] = await db
    .select()
    .from(storageDeletionRequests)
    .where(eq(storageDeletionRequests.id, params.requestId));

  if (request) {
    if (request.companyId !== BigInt(params.companyId)) return { kind: "forbidden" };
    return { kind: "ok", payload: await livePayload("request", request) };
  }

  // No live request — the deletion may have completed and cascaded away.
  // Migration 0022 is what makes this lookup possible at all.
  const [tombstone] = await db
    .select()
    .from(storageDeletionTombstones)
    .where(eq(storageDeletionTombstones.requestId, BigInt(params.requestId)));

  if (!tombstone) return { kind: "not-found" };
  if (tombstone.companyId !== BigInt(params.companyId)) return { kind: "forbidden" };

  return { kind: "ok", payload: tombstonePayload("request", tombstone) };
}

/** Status of whatever deletion covers a document — including a finished one. */
export async function getDeletionStatusByDocumentId(params: {
  documentId: number;
  companyId: number;
}): Promise<DeletionStatusResult> {
  const [tombstone] = await db
    .select()
    .from(storageDeletionTombstones)
    .where(eq(storageDeletionTombstones.documentId, BigInt(params.documentId)));

  if (tombstone) {
    if (tombstone.companyId !== BigInt(params.companyId)) return { kind: "forbidden" };
    return { kind: "ok", payload: tombstonePayload("document", tombstone) };
  }

  const requests = await db
    .select()
    .from(storageDeletionRequests)
    .where(eq(storageDeletionRequests.documentId, BigInt(params.documentId)))
    .orderBy(desc(storageDeletionRequests.id));

  if (requests.length > 0) {
    const [newest, ...rest] = requests;
    if (newest!.companyId !== BigInt(params.companyId)) return { kind: "forbidden" };
    return {
      kind: "ok",
      payload: await livePayload(
        "document",
        newest!,
        rest.map((request) => request.id),
      ),
    };
  }

  // No tombstone and no request. Distinguish "this document has simply never
  // been deleted" (a real, useful answer) from "no such document".
  const [doc] = await db
    .select({ companyId: document.companyId })
    .from(document)
    .where(eq(document.id, params.documentId));

  if (!doc) return { kind: "not-found" };
  if (doc.companyId !== BigInt(params.companyId)) return { kind: "forbidden" };

  return { kind: "no-deletion", documentId: params.documentId };
}

/** Maps a service result to the HTTP shape both routes return. */
export function toHttpResponse(result: DeletionStatusResult): {
  status: number;
  body: Record<string, unknown>;
} {
  switch (result.kind) {
    case "ok":
      return { status: 200, body: { success: true, ...result.payload } };
    case "no-deletion":
      return {
        status: 200,
        body: {
          success: true,
          documentId: result.documentId,
          deletionRequested: false,
          message: "No deletion has been requested for this document.",
        },
      };
    case "forbidden":
      // Same non-disclosure choice the batch delete route makes: don't let
      // this be used to probe which ids exist in other companies.
      return { status: 404, body: { success: false, error: "Not found" } };
    case "not-found":
      return { status: 404, body: { success: false, error: "Not found" } };
  }
}
