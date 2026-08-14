/**
 * One-off manual test for B2 (storage-deletion-coordinator.ts).
 *
 * This has never been executed before — this script exercises
 * requestDocumentDeletion end-to-end against the local dev database:
 *   1. create a fake company + document
 *   2. register a fake storage_objects row for it (via B1's registerObject)
 *   3. call requestDocumentDeletion
 *   4. print out the resulting storage_deletion_requests / storage_deletion_items
 *      rows, and confirm storage_objects.lifecycleState flipped to DELETE_REQUESTED
 *
 * Everything happens inside a single transaction that is ROLLED BACK at the
 * end (we throw on purpose after logging results), so this never leaves
 * test data behind and is safe to re-run.
 *
 * Run with:
 *   pnpm tsx scripts/test-storage-deletion-coordinator.ts
 */

import "dotenv/config";
import { eq } from "drizzle-orm";
import {
  company,
  document,
  storageObjects,
  storageDeletionRequests,
  storageDeletionItems,
} from "@launchstack/core/db/schema";

import { db } from "../src/server/db";
import { registerObject } from "../src/server/services/storage-manifest";
import { requestDocumentDeletion } from "../src/server/services/storage-deletion-coordinator";

class RollbackSignal extends Error {}

async function run() {
  console.log("[test-b2] Starting (all writes will be rolled back at the end)...");

  try {
    await db.transaction(async (tx) => {
      // 1. Fake company + document
      const [testCompany] = await tx
        .insert(company)
        .values({ name: "B2 test company (rollback)", numberOfEmployees: "1" })
        .returning();
      if (!testCompany) throw new Error("failed to insert test company");
      console.log(`[test-b2] created company id=${testCompany.id}`);

      const [testDoc] = await tx
        .insert(document)
        .values({
          url: "https://example.com/fake-test-doc.pdf",
          category: "test",
          title: "B2 test document",
          companyId: BigInt(testCompany.id),
        })
        .returning();
      if (!testDoc) throw new Error("failed to insert test document");
      console.log(`[test-b2] created document id=${testDoc.id}`);

      // 2. Register a fake manifest object for it
      const obj = await registerObject(tx, {
        adapter: "s3",
        storageLocationId: "test-bucket",
        key: `documents/${testDoc.id}/fake-file.pdf`,
        companyId: testCompany.id,
        documentId: testDoc.id,
        contentType: "application/pdf",
        sizeBytes: 1234,
      });
      console.log(`[test-b2] registered storage_objects id=${obj.id}, lifecycleState=${obj.lifecycleState}`);

      // 3. Call the function under test
      const request = await requestDocumentDeletion(tx, {
        docId: testDoc.id,
        companyId: testCompany.id,
        actorId: "test-script",
      });
      console.log("[test-b2] requestDocumentDeletion returned:", request);

      // 4. Verify — read everything back inside the same transaction
      const items = await tx
        .select()
        .from(storageDeletionItems)
        .where(eq(storageDeletionItems.requestId, BigInt(request.id)));
      console.log(`[test-b2] storage_deletion_items for request ${request.id}:`, items);

      const [refreshedObj] = await tx
        .select()
        .from(storageObjects)
        .where(eq(storageObjects.id, obj.id));
      console.log(`[test-b2] storage_objects.id=${obj.id} lifecycleState is now:`, refreshedObj?.lifecycleState);

      // --- Assertions ---
      const failures: string[] = [];

      if (request.status !== "queued") {
        failures.push(`expected request.status "queued", got "${request.status}"`);
      }
      if (items.length !== 1) {
        failures.push(`expected exactly 1 deletion item, got ${items.length}`);
      } else {
        const [item] = items;
        if (item && item.objectId !== BigInt(obj.id)) {
          failures.push(`expected item.objectId ${obj.id}, got ${item.objectId}`);
        }
        if (item && item.itemState !== "PENDING") {
          failures.push(`expected item.itemState "PENDING", got "${item.itemState}"`);
        }
      }
      if (refreshedObj?.lifecycleState !== "DELETE_REQUESTED") {
        failures.push(
          `expected storage_objects.lifecycleState "DELETE_REQUESTED", got "${refreshedObj?.lifecycleState}"`,
        );
      }

      const [reReadRequest] = await tx
        .select()
        .from(storageDeletionRequests)
        .where(eq(storageDeletionRequests.id, request.id));
      if (!reReadRequest) {
        failures.push("expected to be able to re-read the storage_deletion_requests row, got none");
      }

      if (failures.length > 0) {
        console.error("[test-b2] FAILURES:");
        for (const f of failures) console.error(`  - ${f}`);
        throw new RollbackSignal("test assertions failed (see FAILURES above)");
      }

      console.log("[test-b2] All assertions passed.");
      // Roll back on purpose — this was only ever a test, not real data.
      throw new RollbackSignal("test complete — rolling back on purpose, this is expected");
    });
  } catch (err) {
    if (err instanceof RollbackSignal) {
      console.log(`[test-b2] Transaction rolled back as expected: ${err.message}`);
      if (err.message.startsWith("test assertions failed")) {
        process.exitCode = 1;
      }
      return;
    }
    throw err;
  }
}

run()
  .then(() => {
    console.log("[test-b2] Done.");
    process.exit(process.exitCode ?? 0);
  })
  .catch((err) => {
    console.error("[test-b2] Unexpected error:", err);
    process.exit(1);
  });
