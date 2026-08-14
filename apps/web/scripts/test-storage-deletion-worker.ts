/**
 * One-off manual test for B3 (storageDeletionWorker.ts).
 *
 * The "database" adapter's real delete call is Dev A's task (A3, per the
 * design doc) and isn't implemented yet — deleteByAdapter deliberately
 * returns BLOCKED for it rather than us building a duplicate. So this test
 * has two parts:
 *
 *   Part A — confirms that behavior is real: a database-adapter item goes
 *   through processPendingItems and ends up BLOCKED, and the request ends
 *   up "manual_review" (not silently marked deleted, not purged).
 *
 *   Part B — since Part A can't reach a DELETED state (nothing to call),
 *   this simulates a successful adapter delete by setting the item to
 *   DELETED directly, then calls finalizeRequestIfDone on its own — this is
 *   the part B3 actually owns and fixed (tombstone-before-purge). Confirms:
 *   file_uploads row is gone*, storage_deletion_requests/items cascade away
 *   with the document, and a tombstone survives with the right data.
 *   (*file_uploads is deleted directly by this script in Part B, standing
 *   in for the adapter call Dev A hasn't built yet.)
 *
 * Both parts run against a fresh company/document/file per part; cleanup
 * happens in a `finally` block deleting both test companies, whose
 * cascading FKs clean up everything else.
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
  storageDeletionRequests,
  storageDeletionItems,
  storageDeletionTombstones,
} from "@launchstack/core/db/schema";

import { db } from "../src/server/db";
import { registerObject } from "../src/server/services/storage-manifest";
import { requestDocumentDeletion } from "../src/server/services/storage-deletion-coordinator";
import { processPendingItems, finalizeRequestIfDone } from "../src/server/inngest/functions/storageDeletionWorker";

async function setUpFakeDocument(label: string) {
  const [testCompany] = await db
    .insert(company)
    .values({ name: `B3 test company (${label})`, numberOfEmployees: "1" })
    .returning();
  if (!testCompany) throw new Error("failed to insert test company");

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
      storageLocationId: "database:default",
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
  console.log("[test-b3] Starting (test companies will be deleted at the end)...");

  const failures: string[] = [];
  const companyIdsToCleanUp: number[] = [];

  try {
    // ---- Part A: database adapter is unimplemented -> item goes BLOCKED ----
    console.log("\n[test-b3] Part A: unimplemented database adapter -> BLOCKED");
    const a = await setUpFakeDocument("part-a");
    companyIdsToCleanUp.push(a.testCompany.id);
    console.log(`[test-b3][A] company=${a.testCompany.id} doc=${a.testDoc.id} request=${a.request.id}`);

    await processPendingItems(a.request.id);

    const [itemA] = await db
      .select()
      .from(storageDeletionItems)
      .where(eq(storageDeletionItems.requestId, BigInt(a.request.id)));
    console.log("[test-b3][A] item after processing:", itemA);

    const finalizeA = await finalizeRequestIfDone(a.request.id);
    console.log("[test-b3][A] finalizeRequestIfDone returned:", finalizeA);

    const [requestA] = await db
      .select()
      .from(storageDeletionRequests)
      .where(eq(storageDeletionRequests.id, a.request.id));
    console.log("[test-b3][A] request after finalize:", requestA);

    if (!itemA || itemA.itemState !== "BLOCKED") {
      failures.push(`[A] expected item.itemState "BLOCKED", got "${itemA?.itemState}"`);
    }
    if (finalizeA.allTerminal) {
      failures.push("[A] expected finalizeResult.allTerminal to be false (item is BLOCKED, not terminal)");
    }
    if (finalizeA.purged) {
      failures.push("[A] expected finalizeResult.purged to be false — must not purge with a BLOCKED item");
    }
    if (!requestA || requestA.status !== "manual_review") {
      failures.push(`[A] expected request.status "manual_review", got "${requestA?.status}"`);
    }
    const [docStillThereA] = await db.select().from(document).where(eq(document.id, a.testDoc.id));
    if (!docStillThereA) {
      failures.push("[A] expected document row to still exist (nothing should be purged when blocked)");
    }

    // ---- Part B: simulate a successful delete -> confirm purge + tombstone ----
    console.log("\n[test-b3] Part B: simulated successful delete -> purge + tombstone");
    const b = await setUpFakeDocument("part-b");
    companyIdsToCleanUp.push(b.testCompany.id);
    console.log(`[test-b3][B] company=${b.testCompany.id} doc=${b.testDoc.id} request=${b.request.id}`);

    // Stand in for Dev A's not-yet-built adapter call: delete the
    // file_uploads row directly and mark the item DELETED, exactly as a
    // real adapter call would leave things.
    await db.delete(fileUploads).where(eq(fileUploads.id, b.upload.id));
    await db
      .update(storageDeletionItems)
      .set({ itemState: "DELETED", lastError: null })
      .where(eq(storageDeletionItems.requestId, BigInt(b.request.id)));

    const finalizeB = await finalizeRequestIfDone(b.request.id);
    console.log("[test-b3][B] finalizeRequestIfDone returned:", finalizeB);

    const [tombstoneB] = await db
      .select()
      .from(storageDeletionTombstones)
      .where(eq(storageDeletionTombstones.documentId, BigInt(b.testDoc.id)));
    console.log("[test-b3][B] tombstone after finalize:", tombstoneB);

    const [requestGoneB] = await db
      .select()
      .from(storageDeletionRequests)
      .where(eq(storageDeletionRequests.id, b.request.id));
    console.log("[test-b3][B] request row after finalize (expected: gone):", requestGoneB);

    const [remainingDocB] = await db.select().from(document).where(eq(document.id, b.testDoc.id));

    if (!finalizeB.allTerminal) failures.push("[B] expected finalizeResult.allTerminal to be true");
    if (!finalizeB.purged) failures.push("[B] expected finalizeResult.purged to be true");
    if (!tombstoneB || tombstoneB.finalStatus !== "completed") {
      failures.push(`[B] expected a tombstone with finalStatus "completed", got ${JSON.stringify(tombstoneB)}`);
    }
    if (tombstoneB && tombstoneB.objectCount !== 1) {
      failures.push(`[B] expected tombstone.objectCount 1, got ${tombstoneB.objectCount}`);
    }
    if (requestGoneB) {
      failures.push("[B] expected storage_deletion_requests row to be cascade-deleted along with the document, but it still exists");
    }
    if (remainingDocB) {
      failures.push("[B] expected document row to be purged, but it still exists");
    }

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
