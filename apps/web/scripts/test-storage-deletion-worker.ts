/**
 * Manual test for B3 (storageDeletionWorker.ts) + the coordinator/admin
 * additions built alongside it: the kill switch, the STORAGE_DELETING/
 * CANCELLED object-state slice, cancellation, idempotent re-delete via
 * tombstone, and the admin requeue/quarantine repair path.
 *
 * UPDATED now that Dev A's A3 (database-backed delete) has shipped. The
 * database adapter really deletes the file_uploads row, so an item no longer
 * lands on BLOCKED by accident.
 *
 * The parts that specifically need a BLOCKED item (cancellation-refused-
 * after-start, admin repair) now get one deliberately, by registering the
 * object against a stale storageLocationId — which is a real, documented
 * outcome (Decision 4: a ref whose location doesn't match what current env
 * would mint is blocked, never silently deleted from the new location).
 *
 * Part D no longer fakes the delete: it runs the real worker end to end,
 * so DELETED -> purge -> tombstone is actually exercised.
 *
 * Run with:
 *   pnpm tsx scripts/test-storage-deletion-worker.ts
 */

import "dotenv/config";
import { eq } from "drizzle-orm";
import {
  company,
  document,
  fileUploads,
  storageObjects,
  storageDeletionRequests,
  storageDeletionItems,
  storageDeletionTombstones,
} from "@launchstack/core/db/schema";

import { db } from "../src/server/db";
import { registerObject } from "../src/server/services/storage-manifest";
import {
  requestDocumentDeletion,
  requestDocumentDeletionAndDispatch,
  cancelDeletionRequest,
  CancellationRefusedError,
} from "../src/server/services/storage-deletion-coordinator";
import {
  requeueBlockedDeletionItem,
  quarantineBlockedDeletionItem,
  AdminActionRefusedError,
} from "../src/server/services/storage-deletion-admin";
import { processPendingItems, finalizeRequestIfDone } from "../src/server/inngest/functions/storageDeletionWorker";
import { resolveStorageLocationId } from "../src/lib/storage-location-id";

/** What the active config would mint for a database-backed object. */
const LIVE_DATABASE_LOCATION = resolveStorageLocationId("database");

/**
 * A location id the active config would never mint. Stands in for a ref
 * created before a storage reconfiguration — Decision 4 says those must be
 * reported blocked, not deleted out of whatever store is configured now.
 */
const STALE_DATABASE_LOCATION = "database:retired_store_v0";

const failures: string[] = [];
const companyIdsToCleanUp: number[] = [];

function check(condition: boolean, label: string) {
  if (!condition) failures.push(label);
}

async function setUpFakeDocument(label: string, storageLocationId = LIVE_DATABASE_LOCATION) {
  const [testCompany] = await db
    .insert(company)
    .values({ name: `B3 test company (${label})`, numberOfEmployees: "1" })
    .returning();
  if (!testCompany) throw new Error("failed to insert test company");
  companyIdsToCleanUp.push(testCompany.id);

  const [testDoc] = await db
    .insert(document)
    .values({
      url: `https://example.com/fake-test-doc-${label}.pdf`,
      category: "test",
      title: `B3 test document (${label})`,
      companyId: BigInt(testCompany.id),
    })
    .returning();
  if (!testDoc) throw new Error("failed to insert test document");

  const [upload] = await db
    .insert(fileUploads)
    .values({
      userId: "test-script",
      filename: "fake-file.pdf",
      mimeType: "application/pdf",
      fileData: "ZmFrZSBmaWxlIGJ5dGVz",
      fileSize: 17,
      storageProvider: "database",
    })
    .returning();
  if (!upload) throw new Error("failed to insert test file_uploads row");

  const { obj, request } = await db.transaction(async (tx) => {
    const registeredObj = await registerObject(tx, {
      adapter: "database",
      storageLocationId,
      key: String(upload.id),
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

async function run() {
  console.log("[test-b3] Starting (test companies will be deleted at the end)...\n");

  try {
    // ---- Part A: kill switch off -> outbox intact ----
    console.log("[test-b3] Part A: kill switch off -> processing skipped, nothing touched");
    process.env.STORAGE_DELETION_WORKER_ENABLED = "false";
    const a = await setUpFakeDocument("kill-switch");

    const resultA = await processPendingItems(a.request.id);
    console.log("[test-b3][A] processPendingItems returned:", resultA);

    const [itemA] = await db
      .select()
      .from(storageDeletionItems)
      .where(eq(storageDeletionItems.requestId, BigInt(a.request.id)));
    const [objA] = await db.select().from(storageObjects).where(eq(storageObjects.id, a.obj.id));

    check(resultA.skipped === true, "[A] expected processPendingItems to report skipped=true");
    check(itemA?.itemState === "PENDING", `[A] expected item untouched (PENDING), got "${itemA?.itemState}"`);
    check(
      objA?.lifecycleState === "DELETE_REQUESTED",
      `[A] expected object untouched (DELETE_REQUESTED), got "${objA?.lifecycleState}"`,
    );

    // From here on, the worker is enabled for the rest of the parts.
    process.env.STORAGE_DELETION_WORKER_ENABLED = "true";

    // ---- Part B: cancel before anything starts -> allowed ----
    console.log("\n[test-b3] Part B: cancel before processing starts -> allowed");
    const b = await setUpFakeDocument("cancel-before");

    await cancelDeletionRequest(b.request.id, "test-admin");
    const [objBAfterCancel] = await db.select().from(storageObjects).where(eq(storageObjects.id, b.obj.id));
    check(
      objBAfterCancel?.lifecycleState === "CANCELLED",
      `[B] expected object CANCELLED after cancel, got "${objBAfterCancel?.lifecycleState}"`,
    );

    // Worker should now skip this item entirely, leaving it PENDING.
    await processPendingItems(b.request.id);
    const [itemBAfterProcess] = await db
      .select()
      .from(storageDeletionItems)
      .where(eq(storageDeletionItems.requestId, BigInt(b.request.id)));
    check(
      itemBAfterProcess?.itemState === "PENDING",
      `[B] expected item still PENDING (worker should skip a CANCELLED object), got "${itemBAfterProcess?.itemState}"`,
    );

    // ---- Part C: cancel refused once deletion has actually started ----
    console.log("\n[test-b3] Part C: cancel refused once item has already been touched");
    // Stale location -> the delete is refused as blocked, which is what this
    // part needs: an item that has demonstrably *started* and can't be cancelled.
    const c = await setUpFakeDocument("cancel-after", STALE_DATABASE_LOCATION);

    await processPendingItems(c.request.id); // stale location -> BLOCKED, object -> BLOCKED
    const [objCBeforeCancel] = await db.select().from(storageObjects).where(eq(storageObjects.id, c.obj.id));
    console.log("[test-b3][C] object state after processing (expected BLOCKED):", objCBeforeCancel?.lifecycleState);

    let cancelWasRefused = false;
    try {
      await cancelDeletionRequest(c.request.id, "test-admin");
    } catch (err) {
      cancelWasRefused = err instanceof CancellationRefusedError;
    }
    check(cancelWasRefused, "[C] expected cancelDeletionRequest to throw CancellationRefusedError");
    const [objCAfterCancelAttempt] = await db.select().from(storageObjects).where(eq(storageObjects.id, c.obj.id));
    check(
      objCAfterCancelAttempt?.lifecycleState === "BLOCKED",
      `[C] expected object to remain BLOCKED after refused cancel, got "${objCAfterCancelAttempt?.lifecycleState}"`,
    );

    // ---- Part D: simulate success -> purge + tombstone, then idempotent re-delete ----
    console.log("\n[test-b3] Part D: purge + tombstone, then a second delete request is idempotent");
    const d = await setUpFakeDocument("idempotent");

    // Real end-to-end run now that A3 exists: the worker itself deletes the
    // file_uploads row through the database adapter. No faked outcome.
    await processPendingItems(d.request.id);

    const [itemD] = await db
      .select()
      .from(storageDeletionItems)
      .where(eq(storageDeletionItems.requestId, BigInt(d.request.id)));
    check(
      itemD?.itemState === "DELETED",
      `[D] expected the real database-adapter delete to mark the item DELETED, got "${itemD?.itemState}" (${itemD?.lastError ?? "no error"})`,
    );

    const [uploadDAfter] = await db
      .select()
      .from(fileUploads)
      .where(eq(fileUploads.id, d.upload.id));
    check(!uploadDAfter, "[D] expected the file_uploads row to actually be gone");

    const finalizeD = await finalizeRequestIfDone(d.request.id);
    check(finalizeD.purged === true, "[D] expected the document to be purged");

    const [tombstoneD] = await db
      .select()
      .from(storageDeletionTombstones)
      .where(eq(storageDeletionTombstones.documentId, BigInt(d.testDoc.id)));
    check(!!tombstoneD, "[D] expected a tombstone to exist after purge");

    const secondAttempt = await requestDocumentDeletionAndDispatch({
      docId: d.testDoc.id,
      companyId: d.testCompany.id,
      actorId: "test-script",
    });
    console.log("[test-b3][D] second delete request on the same (already-purged) doc returned:", secondAttempt);
    check(
      secondAttempt.kind === "already-completed",
      `[D] expected the second delete request to return "already-completed", got "${secondAttempt.kind}"`,
    );

    // ---- Part E: admin repair path (requeue, then quarantine) ----
    console.log("\n[test-b3] Part E: admin requeue, then approved-exception quarantine");
    // Stale location again — the admin repair path only acts on BLOCKED items.
    const e = await setUpFakeDocument("admin-repair", STALE_DATABASE_LOCATION);

    await processPendingItems(e.request.id); // stale location -> BLOCKED
    const [itemEBlocked] = await db
      .select()
      .from(storageDeletionItems)
      .where(eq(storageDeletionItems.requestId, BigInt(e.request.id)));
    if (!itemEBlocked) throw new Error("[E] expected a deletion item to exist");

    await requeueBlockedDeletionItem(itemEBlocked.id, "test-admin");
    const [itemEAfterRequeue] = await db
      .select()
      .from(storageDeletionItems)
      .where(eq(storageDeletionItems.id, itemEBlocked.id));
    const [objEAfterRequeue] = await db.select().from(storageObjects).where(eq(storageObjects.id, e.obj.id));
    check(
      itemEAfterRequeue?.itemState === "WAITING_RETRY" && itemEAfterRequeue?.attempts === 0,
      `[E] expected item WAITING_RETRY with attempts reset to 0 after requeue, got state="${itemEAfterRequeue?.itemState}" attempts=${itemEAfterRequeue?.attempts}`,
    );
    check(
      objEAfterRequeue?.lifecycleState === "STORAGE_DELETING",
      `[E] expected object STORAGE_DELETING after requeue, got "${objEAfterRequeue?.lifecycleState}"`,
    );

    // Quarantine should refuse right now — the item isn't BLOCKED anymore.
    let quarantineRefusedTooEarly = false;
    try {
      await quarantineBlockedDeletionItem(itemEBlocked.id, "test-admin", "should be refused");
    } catch (err) {
      quarantineRefusedTooEarly = err instanceof AdminActionRefusedError;
    }
    check(
      quarantineRefusedTooEarly,
      "[E] expected quarantineBlockedDeletionItem to refuse a non-BLOCKED item",
    );

    // Process again — the location is still stale, so it goes BLOCKED again.
    await processPendingItems(e.request.id);
    await quarantineBlockedDeletionItem(itemEBlocked.id, "test-admin", "manual override, approved");
    const [itemEQuarantined] = await db
      .select()
      .from(storageDeletionItems)
      .where(eq(storageDeletionItems.id, itemEBlocked.id));
    const [objEQuarantined] = await db.select().from(storageObjects).where(eq(storageObjects.id, e.obj.id));
    check(
      itemEQuarantined?.itemState === "QUARANTINED",
      `[E] expected item QUARANTINED, got "${itemEQuarantined?.itemState}"`,
    );
    check(
      objEQuarantined?.lifecycleState === "QUARANTINED",
      `[E] expected object QUARANTINED, got "${objEQuarantined?.lifecycleState}"`,
    );

    const finalizeE = await finalizeRequestIfDone(e.request.id);
    console.log("[test-b3][E] finalizeRequestIfDone after quarantine:", finalizeE);
    check(finalizeE.purged === false, "[E] expected no purge with a QUARANTINED item");
    const [requestE] = await db
      .select()
      .from(storageDeletionRequests)
      .where(eq(storageDeletionRequests.id, e.request.id));
    check(
      requestE?.status === "quarantined",
      `[E] expected request.status "quarantined", got "${requestE?.status}"`,
    );

    // ---- Report ----
    if (failures.length > 0) {
      console.error("\n[test-b3] FAILURES:");
      for (const f of failures) console.error(`  - ${f}`);
      process.exitCode = 1;
    } else {
      console.log("\n[test-b3] All assertions passed.");
    }
  } finally {
    for (const id of companyIdsToCleanUp) {
      await db.delete(company).where(eq(company.id, id));
      console.log(`[test-b3] cleaned up test company id=${id}`);
    }
  }
}

run()
  .then(() => {
    console.log("[test-b3] Done.");
    process.exit(process.exitCode ?? 0);
  })
  .catch((err) => {
    console.error("[test-b3] Unexpected error:", err);
    process.exit(1);
  });
