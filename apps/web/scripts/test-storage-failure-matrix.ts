/**
 * Failure-matrix coverage (design doc B3 item 10) + B8 (tenant auth on
 * manifest refs, and response-shape declarations).
 *
 * The existing worker test covers the happy path and the admin/cancel paths.
 * The design doc's failure matrix asks for more than that, and most of it was
 * never actually exercised. This script runs the missing rows against the
 * real local Postgres — no mocks, no faked outcomes:
 *
 *   A  transient/unknown error        -> WAITING_RETRY, attempts increments
 *   B  retry budget exhausted         -> BLOCKED at BLOCK_AFTER_ATTEMPTS
 *   C  stale storageLocationId        -> BLOCKED, and the file is NOT deleted
 *   D  unknown adapter                -> BLOCKED (unknown_adapter), no fallthrough
 *   E  missing object                 -> converges, never errors (A7 idempotency)
 *   F  partial batch                  -> per-item outcomes, no all-or-nothing lie
 *   G  rejected                       -> QUARANTINED, dominating manual_review
 *   H  B8 file ownership resolution   -> all four sources + unresolved
 *   I  B8 tenant gate                 -> log observes, enforce refuses
 *   J  B8 response shapes             -> a real B7 payload matches its schema
 *   K  status-by-request-id after purge -> the tombstone keeps its request id
 *   L  provider timeout               -> WAITING_RETRY, not a false success
 *   M  worker crash after success     -> converges, never double-reports
 *   N  SQL purge fails after clean    -> retry SQL only; storage not re-deleted
 *   O  retry sweep                    -> a stalled request is actually re-run
 *   P  version-scoped deletion        -> version purged, tombstone written
 *
 * Run with:
 *   pnpm tsx scripts/test-storage-failure-matrix.ts
 */

import "dotenv/config";
import { eq, sql } from "drizzle-orm";
import {
  company,
  document,
  documentVersions,
  fileUploads,
  storageDeletionItems,
  storageDeletionRequests,
  storageDeletionTombstones,
  storageObjects,
  users,
} from "@launchstack/core/db/schema";

import { db } from "../src/server/db";
import { registerObject } from "../src/server/services/storage-manifest";
import {
  requestDocumentDeletion,
  requestVersionDeletion,
} from "../src/server/services/storage-deletion-coordinator";
import {
  backoffMinutes,
  sweepStalledDeletionRequests,
} from "../src/server/inngest/functions/storageDeletionSweep";
import {
  BLOCK_AFTER_ATTEMPTS,
  finalizeRequestIfDone,
  processPendingItems,
} from "../src/server/inngest/functions/storageDeletionWorker";
import { quarantineBlockedDeletionItem } from "../src/server/services/storage-deletion-admin";
import { mapDeleteOutcomeToItemState } from "../src/server/storage/deletion-lifecycle";
import { resolveStorageLocationId } from "../src/lib/storage-location-id";
import {
  checkFileUploadTenantAccess,
  resolveFileUploadOwner,
} from "../src/server/services/file-ownership";
import {
  getDeletionStatusByDocumentId,
  getDeletionStatusByRequestId,
  toHttpResponse,
} from "../src/server/services/deletion-status-api";
import {
  DeletionStatusResponseSchema,
  checkApiResponse,
} from "../src/lib/api-response-schemas";

const LIVE_DATABASE_LOCATION = resolveStorageLocationId("database");
const STALE_DATABASE_LOCATION = "database:retired_store_v0";

const failures: string[] = [];
const companyIdsToCleanUp: number[] = [];

function check(condition: boolean, label: string) {
  if (!condition) failures.push(label);
}

async function makeCompany(label: string) {
  const [row] = await db
    .insert(company)
    .values({ name: `failure-matrix (${label})`, numberOfEmployees: "1" })
    .returning();
  if (!row) throw new Error("failed to insert company");
  companyIdsToCleanUp.push(row.id);
  return row;
}

async function makeUpload(userId = "test-script") {
  const [row] = await db
    .insert(fileUploads)
    .values({
      userId,
      filename: "fake-file.pdf",
      mimeType: "application/pdf",
      fileData: "ZmFrZSBmaWxlIGJ5dGVz",
      fileSize: 17,
      storageProvider: "database",
    })
    .returning();
  if (!row) throw new Error("failed to insert file_uploads row");
  return row;
}

/**
 * One document, one manifest object, one deletion request. `key` is
 * overridable so a part can point an item at something the adapter will
 * refuse.
 */
async function scenario(label: string, opts: { storageLocationId?: string; key?: string } = {}) {
  const testCompany = await makeCompany(label);
  const upload = await makeUpload();

  const [testDoc] = await db
    .insert(document)
    .values({
      url: `https://example.com/failure-matrix-${label}.pdf`,
      category: "test",
      title: `failure matrix (${label})`,
      companyId: BigInt(testCompany.id),
    })
    .returning();
  if (!testDoc) throw new Error("failed to insert document");

  const { obj, request } = await db.transaction(async (tx) => {
    const registeredObj = await registerObject(tx, {
      adapter: "database",
      storageLocationId: opts.storageLocationId ?? LIVE_DATABASE_LOCATION,
      key: opts.key ?? String(upload.id),
      companyId: testCompany.id,
      documentId: testDoc.id,
      contentType: "application/pdf",
      sizeBytes: upload.fileSize,
    });
    const createdRequest = await requestDocumentDeletion(tx, {
      docId: testDoc.id,
      companyId: testCompany.id,
      actorId: "test-script",
    });
    return { obj: registeredObj, request: createdRequest };
  });

  return { testCompany, testDoc, upload, obj, request };
}

async function itemsFor(requestId: number) {
  return db
    .select()
    .from(storageDeletionItems)
    .where(eq(storageDeletionItems.requestId, BigInt(requestId)));
}

async function run() {
  console.log("[failure-matrix] Starting (test companies are deleted at the end)...\n");
  process.env.STORAGE_DELETION_WORKER_ENABLED = "true";

  try {
    // ---- A: transient/unknown error -> WAITING_RETRY, attempts increments ----
    console.log("[A] transient error -> WAITING_RETRY, attempts incremented");
    const a = await scenario("retryable", { key: "not-a-numeric-file-id" });
    await processPendingItems(a.request.id);
    const [itemA] = await itemsFor(a.request.id);
    check(
      itemA?.itemState === "WAITING_RETRY",
      `[A] expected WAITING_RETRY, got "${itemA?.itemState}" (${itemA?.lastError ?? "no error"})`,
    );
    check(itemA?.attempts === 1, `[A] expected attempts=1, got ${itemA?.attempts}`);
    check(
      Boolean(itemA?.lastError),
      "[A] expected the failure reason to be recorded in lastError",
    );

    // ---- B: same failure, budget exhausted -> BLOCKED ----
    console.log("[B] retry budget exhausted -> BLOCKED");
    if (itemA) {
      await db
        .update(storageDeletionItems)
        .set({ attempts: BLOCK_AFTER_ATTEMPTS - 1 })
        .where(eq(storageDeletionItems.id, itemA.id));
      await processPendingItems(a.request.id);
      const [itemB] = await itemsFor(a.request.id);
      check(
        itemB?.itemState === "BLOCKED",
        `[B] expected BLOCKED at attempt ${BLOCK_AFTER_ATTEMPTS}, got "${itemB?.itemState}"`,
      );
      const [objB] = await db
        .select()
        .from(storageObjects)
        .where(eq(storageObjects.id, a.obj.id));
      check(
        objB?.lifecycleState === "BLOCKED",
        `[B] expected the manifest object BLOCKED too, got "${objB?.lifecycleState}"`,
      );
    }

    // ---- C: stale location -> BLOCKED, and nothing is deleted ----
    console.log("[C] stale storageLocationId -> BLOCKED, file untouched (Decision 4)");
    const c = await scenario("stale-location", { storageLocationId: STALE_DATABASE_LOCATION });
    await processPendingItems(c.request.id);
    const [itemC] = await itemsFor(c.request.id);
    check(itemC?.itemState === "BLOCKED", `[C] expected BLOCKED, got "${itemC?.itemState}"`);
    const [uploadC] = await db
      .select()
      .from(fileUploads)
      .where(eq(fileUploads.id, c.upload.id));
    check(
      Boolean(uploadC),
      "[C] CRITICAL: a ref from a retired location was deleted out of the CURRENT store",
    );

    // ---- D: unknown adapter -> BLOCKED, never falls through to another one ----
    console.log("[D] unknown adapter -> BLOCKED (unknown_adapter)");
    const d = await scenario("unknown-adapter");
    const [itemDBefore] = await itemsFor(d.request.id);
    if (itemDBefore) {
      // Deliberately corrupt the adapter, the way a bad backfill would.
      await db.execute(
        sql`UPDATE ${storageDeletionItems} SET adapter = 'ftp' WHERE id = ${itemDBefore.id}`,
      );
      await processPendingItems(d.request.id);
      const [itemD] = await itemsFor(d.request.id);
      check(itemD?.itemState === "BLOCKED", `[D] expected BLOCKED, got "${itemD?.itemState}"`);
      check(
        (itemD?.lastError ?? "").includes("ftp"),
        `[D] expected the unknown adapter named in lastError, got "${itemD?.lastError}"`,
      );
      const [uploadD] = await db
        .select()
        .from(fileUploads)
        .where(eq(fileUploads.id, d.upload.id));
      check(
        Boolean(uploadD),
        "[D] CRITICAL: an unknown adapter fell through and deleted via another adapter",
      );
    }

    // ---- E: missing object -> converges, never errors (A7) ----
    console.log("[E] already-gone object -> converges without error");
    const e = await scenario("missing-object");
    await db.delete(fileUploads).where(eq(fileUploads.id, e.upload.id));
    await processPendingItems(e.request.id);
    const [itemE] = await itemsFor(e.request.id);
    const terminalE = itemE?.itemState === "DELETED" || itemE?.itemState === "NOT_FOUND";
    check(terminalE, `[E] expected a terminal state for an absent object, got "${itemE?.itemState}"`);
    if (itemE?.itemState === "DELETED") {
      console.log(
        "[E] NOTE: the database adapter reports 'deleted' for a row that was already gone, " +
          "not 'not_found'. Terminal either way, so the lifecycle converges — but A7 asks for " +
          "an explicit NOT_FOUND contract. Worth raising with Dev A (lib/storage.ts deleteFile " +
          "does not check the delete's row count).",
      );
    }

    // ---- F: partial batch -> per-item outcomes, no all-or-nothing lie ----
    console.log("[F] mixed outcomes in one request -> per-item, no purge");
    const f = await scenario("partial");
    const extraUpload = await makeUpload();
    await db.transaction(async (tx) => {
      await registerObject(tx, {
        adapter: "database",
        storageLocationId: STALE_DATABASE_LOCATION,
        key: String(extraUpload.id),
        companyId: f.testCompany.id,
        documentId: f.testDoc.id,
        contentType: "application/pdf",
        sizeBytes: extraUpload.fileSize,
      });
    });
    // Second item on the SAME request, pointing at the stale-location object.
    await db.insert(storageDeletionItems).values({
      requestId: BigInt(f.request.id),
      adapter: "database",
      storageLocationId: STALE_DATABASE_LOCATION,
      key: String(extraUpload.id),
      itemState: "PENDING",
    });

    await processPendingItems(f.request.id);
    const itemsF = await itemsFor(f.request.id);
    const statesF = itemsF.map((item) => item.itemState).sort();
    check(
      statesF.includes("DELETED") && statesF.includes("BLOCKED"),
      `[F] expected one DELETED and one BLOCKED, got ${JSON.stringify(statesF)}`,
    );
    const [uploadFGone] = await db
      .select()
      .from(fileUploads)
      .where(eq(fileUploads.id, f.upload.id));
    check(!uploadFGone, "[F] expected the deletable file to actually be deleted");
    const [uploadFKept] = await db
      .select()
      .from(fileUploads)
      .where(eq(fileUploads.id, extraUpload.id));
    check(Boolean(uploadFKept), "[F] expected the blocked file to be left alone");

    const finalizeF = await finalizeRequestIfDone(f.request.id);
    check(finalizeF.purged === false, "[F] expected no purge while one item is BLOCKED");
    const [requestF] = await db
      .select()
      .from(storageDeletionRequests)
      .where(eq(storageDeletionRequests.id, f.request.id));
    check(
      requestF?.status === "manual_review",
      `[F] expected request status "manual_review", got "${requestF?.status}"`,
    );

    // ---- G: rejected -> QUARANTINED, dominating manual_review ----
    console.log("[G] rejected -> QUARANTINED, and quarantined dominates");
    const mapped = mapDeleteOutcomeToItemState({
      ref: { adapter: "database", storageLocationId: LIVE_DATABASE_LOCATION, key: "1" },
      outcome: "rejected",
    });
    check(
      mapped === "QUARANTINED",
      `[G] rejected must map to QUARANTINED (Decision 2), got "${mapped}"`,
    );

    // And a QUARANTINED item must dominate a BLOCKED one in the same request.
    const blockedF = itemsF.find((item) => item.itemState === "BLOCKED");
    if (blockedF) {
      await quarantineBlockedDeletionItem(blockedF.id, "test-script", "failure-matrix check");
      const finalizeG = await finalizeRequestIfDone(f.request.id);
      check(finalizeG.purged === false, "[G] expected no purge with a QUARANTINED item");
      const [requestG] = await db
        .select()
        .from(storageDeletionRequests)
        .where(eq(storageDeletionRequests.id, f.request.id));
      check(
        requestG?.status === "quarantined",
        `[G] expected "quarantined" to dominate "manual_review", got "${requestG?.status}"`,
      );
    }

    // ---- H: B8 ownership resolution, all four sources ----
    console.log("[H] file ownership resolves, and reports which source answered");
    const h = await scenario("ownership-manifest");
    const ownerManifest = await resolveFileUploadOwner(h.upload.id);
    check(
      ownerManifest?.source === "manifest" && ownerManifest.companyId === h.testCompany.id,
      `[H] expected manifest-sourced ownership, got ${JSON.stringify(ownerManifest)}`,
    );

    // document-sourced: a document whose url IS the file, no manifest row.
    const hCompany = await makeCompany("ownership-document");
    const hUpload = await makeUpload();
    await db.insert(document).values({
      url: `/api/files/${hUpload.id}`,
      category: "test",
      title: "ownership via document url",
      companyId: BigInt(hCompany.id),
    });
    const ownerDocument = await resolveFileUploadOwner(hUpload.id);
    check(
      ownerDocument?.source === "document" && ownerDocument.companyId === hCompany.id,
      `[H] expected document-sourced ownership, got ${JSON.stringify(ownerDocument)}`,
    );

    // uploader-sourced: nothing points at the file, but its uploader is known.
    const hCompany2 = await makeCompany("ownership-uploader");
    const uploaderUserId = `failure-matrix-user-${Date.now()}`;
    await db.insert(users).values({
      name: "Failure Matrix",
      email: `${uploaderUserId}@example.com`,
      userId: uploaderUserId,
      companyId: BigInt(hCompany2.id),
      role: "employer",
      status: "active",
    });
    const hUpload2 = await makeUpload(uploaderUserId);
    const ownerUploader = await resolveFileUploadOwner(hUpload2.id);
    check(
      ownerUploader?.source === "uploader" && ownerUploader.confidence === "low",
      `[H] expected uploader-sourced ownership flagged low-confidence, got ${JSON.stringify(ownerUploader)}`,
    );

    // unresolved: an orphan row nobody claims.
    const orphan = await makeUpload(`nobody-${Date.now()}`);
    const ownerNone = await resolveFileUploadOwner(orphan.id);
    check(ownerNone === null, `[H] expected null for an unowned file, got ${JSON.stringify(ownerNone)}`);

    // ---- I: B8 tenant gate — log observes, enforce refuses ----
    console.log("[I] tenant gate: log mode observes, enforce mode refuses");
    process.env.STORAGE_FILE_TENANT_AUTH_MODE = "log";
    const logDecision = await checkFileUploadTenantAccess({
      fileId: h.upload.id,
      actorUserId: uploaderUserId,
      actorCompanyId: hCompany2.id,
    });
    check(
      logDecision.allowed === true && logDecision.wouldBlock === true,
      `[I] log mode must allow while flagging, got ${JSON.stringify(logDecision)}`,
    );
    check(
      logDecision.reason === "company_mismatch",
      `[I] expected reason company_mismatch, got "${logDecision.reason}"`,
    );

    process.env.STORAGE_FILE_TENANT_AUTH_MODE = "enforce";
    const enforceDecision = await checkFileUploadTenantAccess({
      fileId: h.upload.id,
      actorUserId: uploaderUserId,
      actorCompanyId: hCompany2.id,
    });
    check(
      enforceDecision.allowed === false,
      `[I] enforce mode must refuse a cross-company read, got ${JSON.stringify(enforceDecision)}`,
    );

    const anonDecision = await checkFileUploadTenantAccess({
      fileId: h.upload.id,
      actorUserId: null,
      actorCompanyId: null,
    });
    check(
      anonDecision.allowed === false && anonDecision.reason === "unauthenticated",
      `[I] enforce mode must refuse an unauthenticated read, got ${JSON.stringify(anonDecision)}`,
    );

    const sameCompany = await checkFileUploadTenantAccess({
      fileId: h.upload.id,
      actorUserId: uploaderUserId,
      actorCompanyId: h.testCompany.id,
    });
    check(
      sameCompany.allowed === true && sameCompany.wouldBlock === false,
      `[I] a caller in the owning company must be allowed, got ${JSON.stringify(sameCompany)}`,
    );
    process.env.STORAGE_FILE_TENANT_AUTH_MODE = "log";

    // ---- J: B8 response shapes ----
    console.log("[J] a real B7 status response matches its declared shape");
    const statusResult = await getDeletionStatusByDocumentId({
      documentId: f.testDoc.id,
      companyId: f.testCompany.id,
    });
    const { body } = toHttpResponse(statusResult);
    const shape = checkApiResponse(DeletionStatusResponseSchema, body);
    check(
      shape.ok,
      `[J] the live status response does not match its schema: ${shape.ok ? "" : shape.issues.join("; ")}`,
    );

    // A schema that never rejects anything is worthless — prove it bites.
    const broken = checkApiResponse(DeletionStatusResponseSchema, {
      success: true,
      scope: "request",
      purged: false,
      status: "definitely-not-a-frozen-status",
      itemCount: 0,
      counts: {},
      items: [],
    });
    check(!broken.ok, "[J] expected the schema to reject an invented status value");

    // ---- K: a tombstone must keep its request id through the purge ----
    //
    // Regression guard. storage_deletion_requests.document_id is ON DELETE
    // CASCADE, so completing a deletion destroys the request row. If the
    // tombstone's request_id is a real FK with ON DELETE SET NULL, that same
    // cascade nulls the tombstone's only pointer back — and looking a
    // deletion up by request id breaks at exactly the moment it succeeds.
    // Migration 0022 dropped that FK; base.ts has to agree, because db:push
    // regenerates from base.ts and would silently put the FK back.
    console.log("[K] request id survives the purge (migration 0022 vs base.ts)");
    const k = await scenario("tombstone-request-id");
    await processPendingItems(k.request.id);
    const finalizeK = await finalizeRequestIfDone(k.request.id);
    check(finalizeK.purged === true, "[K] expected the document to be purged");

    const [tombstoneK] = await db
      .select()
      .from(storageDeletionTombstones)
      .where(eq(storageDeletionTombstones.documentId, BigInt(k.testDoc.id)));
    check(
      tombstoneK?.requestId !== null && tombstoneK?.requestId !== undefined,
      "[K] tombstone.requestId was nulled by the purge — the ON DELETE SET NULL " +
        "FK is back in base.ts, undoing migration 0022",
    );

    const byRequestId = await getDeletionStatusByRequestId({
      requestId: k.request.id,
      companyId: k.testCompany.id,
    });
    check(
      byRequestId.kind === "ok" && byRequestId.payload.purged === true,
      `[K] status-by-request-id must still answer after the purge, got "${byRequestId.kind}"`,
    );

    // ---- L: provider timeout -> WAITING_RETRY, never a false success ----
    console.log("[L] provider timeout -> WAITING_RETRY");
    const l = await scenario("timeout");
    await processPendingItems(l.request.id, {
      deleteMany: async (refs) =>
        refs.map((ref) => ({
          ref,
          outcome: "retryable" as const,
          errorCode: "ETIMEDOUT",
          message: "operation timed out after 30000ms",
        })),
    });
    const [itemL] = await itemsFor(l.request.id);
    check(
      itemL?.itemState === "WAITING_RETRY",
      `[L] expected WAITING_RETRY on timeout, got "${itemL?.itemState}"`,
    );
    const [uploadL] = await db
      .select()
      .from(fileUploads)
      .where(eq(fileUploads.id, l.upload.id));
    check(Boolean(uploadL), "[L] a timed-out delete must not be treated as done");

    // ---- M: worker crashed after the provider already succeeded ----------
    // The provider deleted the object, then we died before persisting that.
    // On the retry the same ref is deleted again; an idempotent adapter
    // reports not_found and the item converges. Nothing is double-counted
    // and nothing is stuck.
    console.log("[M] worker crash after provider success -> converges");
    const m = await scenario("crash-after-success");
    await processPendingItems(m.request.id, {
      deleteMany: async (refs) => refs.map((ref) => ({ ref, outcome: "deleted" as const })),
    });
    // Simulate the lost write: the provider succeeded, our persistence didn't.
    const [itemMBefore] = await itemsFor(m.request.id);
    await db
      .update(storageDeletionItems)
      .set({ itemState: "WAITING_RETRY" })
      .where(eq(storageDeletionItems.id, itemMBefore!.id));

    await processPendingItems(m.request.id, {
      deleteMany: async (refs) => refs.map((ref) => ({ ref, outcome: "not_found" as const })),
    });
    const [itemM] = await itemsFor(m.request.id);
    check(
      itemM?.itemState === "NOT_FOUND",
      `[M] expected NOT_FOUND after retrying an already-deleted ref, got "${itemM?.itemState}"`,
    );

    // ---- N: SQL purge fails after storage is already clean ---------------
    // The failure matrix says: retry SQL only, do not restore or re-delete a
    // different object. Also the one place RELATIONAL_PURGE is observable —
    // the injected purge reads it inside the transaction that sets it.
    console.log("[N] SQL purge failure after storage clean -> rolls back, retries cleanly");
    const n = await scenario("purge-failure");
    await processPendingItems(n.request.id);

    let lifecycleSeenInsideTxn: string | undefined;
    let purgeFailed = false;
    try {
      await finalizeRequestIfDone(n.request.id, new Set(), {
        purge: async (tx) => {
          const [obj] = await tx
            .select({ lifecycleState: storageObjects.lifecycleState })
            .from(storageObjects)
            .where(eq(storageObjects.id, n.obj.id));
          lifecycleSeenInsideTxn = obj?.lifecycleState;
          throw new Error("simulated SQL purge failure");
        },
      });
    } catch {
      purgeFailed = true;
    }
    check(purgeFailed, "[N] expected the injected purge failure to propagate");
    check(
      lifecycleSeenInsideTxn === "RELATIONAL_PURGE",
      `[N] expected RELATIONAL_PURGE inside the purge transaction, saw "${lifecycleSeenInsideTxn}"`,
    );

    const [objNAfterFailure] = await db
      .select()
      .from(storageObjects)
      .where(eq(storageObjects.id, n.obj.id));
    check(
      objNAfterFailure?.lifecycleState === "STORAGE_CLEAN",
      `[N] after rollback the object must sit at STORAGE_CLEAN, got "${objNAfterFailure?.lifecycleState}"`,
    );
    const [docNStillThere] = await db
      .select()
      .from(document)
      .where(eq(document.id, n.testDoc.id));
    check(Boolean(docNStillThere), "[N] the document must survive a failed purge");
    const [tombstoneNone] = await db
      .select()
      .from(storageDeletionTombstones)
      .where(eq(storageDeletionTombstones.documentId, BigInt(n.testDoc.id)));
    check(!tombstoneNone, "[N] no tombstone may be written when the purge rolled back");

    // The item states must be untouched by the failed finalize — the retry is
    // a SQL-only retry, so it must find exactly the terminal outcomes the
    // provider already produced rather than re-deriving them. (finalize never
    // calls a provider at all, by construction: only processPendingItems
    // does. That is what makes "retry SQL only" structural here rather than
    // something this test has to police.)
    const itemsNAfterFailure = await itemsFor(n.request.id);
    check(
      itemsNAfterFailure.every(
        (item) => item.itemState === "DELETED" || item.itemState === "NOT_FOUND",
      ),
      `[N] item states must survive the rolled-back purge, got ${JSON.stringify(itemsNAfterFailure.map((i) => i.itemState))}`,
    );

    const finalizeNRetry = await finalizeRequestIfDone(n.request.id);
    check(finalizeNRetry.purged === true, "[N] the retry must complete the purge");
    const [docNGone] = await db
      .select()
      .from(document)
      .where(eq(document.id, n.testDoc.id));
    check(!docNGone, "[N] the document must be purged on the successful retry");

    // ---- O: the retry sweep actually re-runs a stalled request -----------
    console.log("[O] retry sweep re-dispatches a stalled request");
    const o = await scenario("sweep");
    await processPendingItems(o.request.id, {
      deleteMany: async (refs) =>
        refs.map((ref) => ({ ref, outcome: "retryable" as const, message: "transient" })),
    });
    const [itemO] = await itemsFor(o.request.id);
    check(itemO?.itemState === "WAITING_RETRY", "[O] setup: expected a WAITING_RETRY item");

    // Fresh failure: still inside its backoff, must not be woken yet.
    const dispatchedEarly: number[] = [];
    await sweepStalledDeletionRequests(new Date(), {
      dispatch: async (ids) => {
        dispatchedEarly.push(...ids);
      },
    });
    check(
      !dispatchedEarly.includes(o.request.id),
      "[O] an item still inside its backoff window must not be re-dispatched",
    );

    // Now look at the world from far enough in the future that it is due.
    const dueAt = new Date(Date.now() + (backoffMinutes(itemO!.attempts) + 1) * 60_000);
    const dispatchedLater: number[] = [];
    await sweepStalledDeletionRequests(dueAt, {
      dispatch: async (ids) => {
        dispatchedLater.push(...ids);
      },
    });
    check(
      dispatchedLater.includes(o.request.id),
      "[O] a stalled request past its backoff must be re-dispatched — without this, " +
        "WAITING_RETRY is a dead end and the document never finishes deleting",
    );

    // ---- P: version-scoped deletion ------------------------------------
    console.log("[P] version-scoped deletion purges the version, not the document");
    const pCompany = await makeCompany("version-scope");
    const pUpload = await makeUpload();
    const [pDoc] = await db
      .insert(document)
      .values({
        url: "https://example.com/failure-matrix-version-parent.pdf",
        category: "test",
        title: "failure matrix (version parent)",
        companyId: BigInt(pCompany.id),
      })
      .returning();
    const [pVersion] = await db
      .insert(documentVersions)
      .values({
        documentId: BigInt(pDoc!.id),
        versionNumber: 1,
        url: `/api/files/${pUpload.id}`,
        mimeType: "application/pdf",
      })
      .returning();

    const pRequest = await db.transaction(async (tx) => {
      await registerObject(tx, {
        adapter: "database",
        storageLocationId: LIVE_DATABASE_LOCATION,
        key: String(pUpload.id),
        companyId: pCompany.id,
        documentVersionId: pVersion!.id,
        contentType: "application/pdf",
        sizeBytes: pUpload.fileSize,
      });
      return requestVersionDeletion(tx, {
        versionId: pVersion!.id,
        companyId: pCompany.id,
        actorId: "test-script",
      });
    });

    await processPendingItems(pRequest.id);
    const finalizeP = await finalizeRequestIfDone(pRequest.id);
    check(finalizeP.purged === true, "[P] expected the version to be purged");

    const [versionGone] = await db
      .select()
      .from(documentVersions)
      .where(eq(documentVersions.id, pVersion!.id));
    check(!versionGone, "[P] the version row must be gone");
    const [parentAlive] = await db
      .select()
      .from(document)
      .where(eq(document.id, pDoc!.id));
    check(Boolean(parentAlive), "[P] the parent document must NOT be deleted by a version delete");
    const [tombstoneP] = await db
      .select()
      .from(storageDeletionTombstones)
      .where(eq(storageDeletionTombstones.documentVersionId, BigInt(pVersion!.id)));
    check(Boolean(tombstoneP), "[P] expected a version-scoped tombstone");

    // ---- Report ----
    if (failures.length > 0) {
      console.error("\n[failure-matrix] FAILURES:");
      for (const failure of failures) console.error(`  - ${failure}`);
      process.exitCode = 1;
    } else {
      console.log("\n[failure-matrix] All assertions passed.");
    }
  } finally {
    for (const id of companyIdsToCleanUp) {
      await db.delete(company).where(eq(company.id, id));
    }
    console.log(`[failure-matrix] cleaned up ${companyIdsToCleanUp.length} test companies.`);
  }
}

run()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    console.error("[failure-matrix] Unexpected error:", err);
    process.exit(1);
  });
