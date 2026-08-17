/**
 * Manual test for B4 (handleDeleteDocumentRequest — the core logic behind
 * the single delete API route). Clerk auth can't be exercised from a
 * script, so this calls the function the route delegates to directly,
 * exactly as the real route does after its own auth/role checks pass.
 *
 * Covers:
 *   Part A — flag off -> 503, nothing created
 *   Part B — flag on, fresh document. This actually calls inngest.send,
 *            which requires a real/local Inngest connection this
 *            environment may not have configured — so this part checks
 *            BOTH possible correct outcomes rather than assuming one:
 *              - 202 "queued" if Inngest is reachable (the real happy path)
 *              - 500 + a fully rolled-back request/object if it's not
 *                (the hard-failure behavior we deliberately chose: if the
 *                worker can't be notified, nothing should be left behind)
 *            Either outcome passing confirms correct behavior; what would
 *            FAIL the test is a 202 with no request existing, or a 500
 *            that left an orphaned request/object behind.
 *   Part C — wrong company -> 403 (never reaches inngest.send)
 *   Part D — nonexistent document -> 404 (never reaches inngest.send)
 *   Part E — idempotent re-delete. Deliberately bypasses
 *            handleDeleteDocumentRequest for the setup step (so it doesn't
 *            depend on Inngest being reachable) by calling
 *            requestDocumentDeletion directly, same as the B2/B3 tests,
 *            then simulates a completed deletion. Only the *second* call
 *            goes through handleDeleteDocumentRequest — and the idempotent
 *            path returns early via the tombstone check, before ever
 *            touching inngest.send, so it works regardless of Inngest.
 *
 * Run with:
 *   pnpm tsx scripts/test-delete-document-api.ts
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
} from "@launchstack/core/db/schema";

import { db } from "../src/server/db";
import { registerObject } from "../src/server/services/storage-manifest";
import { requestDocumentDeletion } from "../src/server/services/storage-deletion-coordinator";
import { handleDeleteDocumentRequest } from "../src/server/services/delete-document-api";

const failures: string[] = [];
const companyIdsToCleanUp: number[] = [];

function check(condition: boolean, label: string) {
  if (!condition) failures.push(label);
}

async function setUpFakeDocument(label: string) {
  const [testCompany] = await db
    .insert(company)
    .values({ name: `B4 test company (${label})`, numberOfEmployees: "1" })
    .returning();
  if (!testCompany) throw new Error("failed to insert test company");
  companyIdsToCleanUp.push(testCompany.id);

  const [testDoc] = await db
    .insert(document)
    .values({
      url: `https://example.com/fake-test-doc-${label}.pdf`,
      category: "test",
      title: `B4 test document (${label})`,
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

  const obj = await db.transaction(async (tx) => {
    return registerObject(tx, {
      adapter: "database",
      storageLocationId: "database:default",
      key: String(upload.id),
      companyId: testCompany.id,
      documentId: testDoc.id,
      contentType: "application/pdf",
      sizeBytes: upload.fileSize,
    });
  });

  return { testCompany, testDoc, upload, obj };
}

async function run() {
  console.log("[test-b4] Starting (test companies will be deleted at the end)...\n");

  try {
    // ---- Part A: flag off ----
    console.log("[test-b4] Part A: flag off -> 503");
    process.env.STORAGE_DELETION_LIFECYCLE_ENABLED = "false";
    const a = await setUpFakeDocument("flag-off");
    const resultA = await handleDeleteDocumentRequest({
      documentId: a.testDoc.id,
      companyId: a.testCompany.id,
      actorId: "test-script",
    });
    console.log("[test-b4][A] result:", resultA);
    check(resultA.status === 503, `[A] expected status 503, got ${resultA.status}`);

    process.env.STORAGE_DELETION_LIFECYCLE_ENABLED = "true";

    // ---- Part B: flag on, fresh document ----
    console.log("\n[test-b4] Part B: flag on, fresh document (202 if Inngest reachable, else a clean 500 rollback)");
    const b = await setUpFakeDocument("happy-path");
    // handleDeleteDocumentRequest only catches its own typed errors
    // (DocumentNotFoundError/TenantMismatchError) — a DispatchFailedError
    // is meant to propagate out to the route's own try/catch, which turns
    // it into a 500. Since this test calls the function directly (no
    // route in between), it needs that same try/catch itself.
    let resultB: { status: number; body: Record<string, unknown> };
    try {
      resultB = await handleDeleteDocumentRequest({
        documentId: b.testDoc.id,
        companyId: b.testCompany.id,
        actorId: "test-script",
      });
    } catch (err) {
      resultB = { status: 500, body: { error: err instanceof Error ? err.message : String(err) } };
    }
    console.log("[test-b4][B] result:", resultB);

    if (resultB.status === 202) {
      check(resultB.body.status === "queued", `[B] expected body.status "queued", got "${resultB.body.status}"`);
      check(typeof resultB.body.requestId === "number", "[B] expected a numeric requestId in the response");
      const requestId = resultB.body.requestId as number;
      const items = await db
        .select()
        .from(storageDeletionItems)
        .where(eq(storageDeletionItems.requestId, BigInt(requestId)));
      check(items.length === 1, `[B] expected exactly 1 deletion item, got ${items.length}`);
    } else if (resultB.status === 500) {
      console.log("[test-b4][B] Inngest unreachable in this environment — verifying the rollback was clean");
      const [objAfterRollback] = await db.select().from(storageObjects).where(eq(storageObjects.id, b.obj.id));
      check(
        objAfterRollback?.lifecycleState === "ACTIVE",
        `[B] expected object reverted to ACTIVE after rollback, got "${objAfterRollback?.lifecycleState}"`,
      );
      const requestsForDoc = await db
        .select()
        .from(storageDeletionRequests)
        .where(eq(storageDeletionRequests.documentId, BigInt(b.testDoc.id)));
      check(
        requestsForDoc.length === 0,
        `[B] expected no leftover storage_deletion_requests row after rollback, found ${requestsForDoc.length}`,
      );
    } else {
      failures.push(`[B] unexpected status ${resultB.status} — expected 202 or 500`);
    }

    // ---- Part C: wrong company -> 403 ----
    console.log("\n[test-b4] Part C: wrong company -> 403");
    const c = await setUpFakeDocument("wrong-company");
    const otherCompany = await setUpFakeDocument("wrong-company-other");
    const resultC = await handleDeleteDocumentRequest({
      documentId: c.testDoc.id,
      companyId: otherCompany.testCompany.id, // deliberately the wrong company
      actorId: "test-script",
    });
    console.log("[test-b4][C] result:", resultC);
    check(resultC.status === 403, `[C] expected status 403, got ${resultC.status}`);

    // ---- Part D: nonexistent document -> 404 ----
    console.log("\n[test-b4] Part D: nonexistent document -> 404");
    const resultD = await handleDeleteDocumentRequest({
      documentId: 999_999_999,
      companyId: c.testCompany.id,
      actorId: "test-script",
    });
    console.log("[test-b4][D] result:", resultD);
    check(resultD.status === 404, `[D] expected status 404, got ${resultD.status}`);

    // ---- Part E: idempotent re-delete -> 200 completed ----
    console.log("\n[test-b4] Part E: idempotent re-delete on an already-purged document -> 200 completed");
    const e = await setUpFakeDocument("idempotent");

    // Set up via requestDocumentDeletion directly (same pattern as the
    // B2/B3 tests) — deliberately not going through
    // handleDeleteDocumentRequest here, so this setup step doesn't depend
    // on Inngest being reachable in this environment.
    const eRequest = await db.transaction(async (tx) => {
      return requestDocumentDeletion(tx, {
        docId: e.testDoc.id,
        companyId: e.testCompany.id,
        actorId: "test-script",
      });
    });

    // Stand in for Dev A's not-yet-built adapter call + the worker running:
    // simulate a successful delete and purge directly, same trick as the
    // B3 tests.
    const eRequestId = eRequest.id;
    await db.delete(fileUploads).where(eq(fileUploads.id, e.upload.id));
    await db
      .update(storageDeletionItems)
      .set({ itemState: "DELETED", lastError: null })
      .where(eq(storageDeletionItems.requestId, BigInt(eRequestId)));
    const { finalizeRequestIfDone } = await import("../src/server/inngest/functions/storageDeletionWorker");
    await finalizeRequestIfDone(eRequestId);

    const resultE2 = await handleDeleteDocumentRequest({
      documentId: e.testDoc.id,
      companyId: e.testCompany.id,
      actorId: "test-script",
    });
    console.log("[test-b4][E] second call result:", resultE2);
    check(resultE2.status === 200, `[E] expected second call to return 200, got ${resultE2.status}`);
    check(
      resultE2.body.status === "completed",
      `[E] expected second call body.status "completed", got "${resultE2.body.status}"`,
    );

    // ---- Report ----
    if (failures.length > 0) {
      console.error("\n[test-b4] FAILURES:");
      for (const f of failures) console.error(`  - ${f}`);
      process.exitCode = 1;
    } else {
      console.log("\n[test-b4] All assertions passed.");
    }
  } finally {
    for (const id of companyIdsToCleanUp) {
      await db.delete(company).where(eq(company.id, id));
      console.log(`[test-b4] cleaned up test company id=${id}`);
    }
  }
}

run()
  .then(() => {
    console.log("[test-b4] Done.");
    process.exit(process.exitCode ?? 0);
  })
  .catch((err) => {
    console.error("[test-b4] Unexpected error:", err);
    process.exit(1);
  });
