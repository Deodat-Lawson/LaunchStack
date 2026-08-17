/**
 * Manual test for B7 (deletion status read API), against the real local
 * Postgres. Calls the functions the two GET routes delegate to, since Clerk
 * auth can't be exercised from a script.
 *
 * The two parts that carry the most weight:
 *   Part C — "partial" with per-item detail. This is the state the checklist
 *            singles out, and the state nothing in the system could produce
 *            before B7. It asserts not just the word but that the detail
 *            identifies WHICH item is holding the request up.
 *   Part F — lookup by request id AFTER the deletion completed and the
 *            request row was cascaded away. Before migration 0022 the
 *            tombstone's request_id was nulled by that cascade, so this
 *            lookup returned 404 exactly when it mattered most.
 *
 * Covers:
 *   Part A — document with no deletion -> 200 deletionRequested: false
 *   Part B — fresh request -> "queued", both items reported
 *   Part C — one item DELETED -> "partial" + per-item blockingCompletion
 *   Part D — remaining item BLOCKED -> "manual_review"
 *   Part E — remaining item QUARANTINED -> "quarantined" (dominates)
 *   Part F — completed + purged -> "completed" via BOTH request id and
 *            document id, purged: true
 *   Part G — the worker now PERSISTS "partial" to request.status
 *   Part H — wrong company -> 404 (non-disclosure, not 403)
 *   Part I — nonexistent request id -> 404
 *
 * Run with:
 *   pnpm tsx scripts/test-deletion-status-api.ts
 */

import "dotenv/config";
import { eq } from "drizzle-orm";
import {
  company,
  document,
  fileUploads,
  storageDeletionItems,
  storageDeletionRequests,
  storageDeletionTombstones,
} from "@launchstack/core/db/schema";

import { db } from "../src/server/db";
import { registerObject } from "../src/server/services/storage-manifest";
import { requestDocumentDeletion } from "../src/server/services/storage-deletion-coordinator";
import { finalizeRequestIfDone } from "../src/server/inngest/functions/storageDeletionWorker";
import {
  getDeletionStatusByDocumentId,
  getDeletionStatusByRequestId,
  computeRequestStatus,
  toHttpResponse,
} from "../src/server/services/deletion-status-api";

const failures: string[] = [];
const companyIdsToCleanUp: number[] = [];

function check(condition: boolean, label: string) {
  if (!condition) failures.push(label);
}

async function makeCompany(label: string) {
  const [testCompany] = await db
    .insert(company)
    .values({ name: `B7 test company (${label})`, numberOfEmployees: "1" })
    .returning();
  if (!testCompany) throw new Error("failed to insert test company");
  companyIdsToCleanUp.push(testCompany.id);
  return testCompany;
}

/** A document owning TWO files, so "partial" is reachable. */
async function setUpTwoFileDocument(label: string) {
  const testCompany = await makeCompany(label);

  const uploads: Array<typeof fileUploads.$inferSelect> = [];
  for (const n of [1, 2]) {
    const [upload] = await db
      .insert(fileUploads)
      .values({
        userId: "test-script",
        filename: `fake-file-${n}.pdf`,
        mimeType: "application/pdf",
        fileData: "ZmFrZSBmaWxlIGJ5dGVz",
        fileSize: 17,
        storageProvider: "database",
      })
      .returning();
    if (!upload) throw new Error("failed to insert test file_uploads row");
    uploads.push(upload);
  }

  const [testDoc] = await db
    .insert(document)
    .values({
      url: `/api/files/${uploads[0]!.id}`,
      category: "test",
      title: `B7 test document (${label})`,
      companyId: BigInt(testCompany.id),
    })
    .returning();
  if (!testDoc) throw new Error("failed to insert test document");

  await db.transaction(async (tx) => {
    for (const upload of uploads) {
      await registerObject(tx, {
        adapter: "database",
        storageLocationId: "database:default",
        key: String(upload.id),
        companyId: testCompany.id,
        documentId: testDoc.id,
        contentType: "application/pdf",
        sizeBytes: upload.fileSize,
      });
    }
  });

  return { testCompany, testDoc, uploads };
}

async function requestDeletionFor(docId: number, companyId: number) {
  return db.transaction(async (tx) =>
    requestDocumentDeletion(tx, { docId, companyId, actorId: "test-script" }),
  );
}

/** Reads status by request id and asserts the computed status. */
async function expectRequestStatus(
  requestId: number,
  companyId: number,
  expected: string,
  label: string,
) {
  const result = await getDeletionStatusByRequestId({ requestId, companyId });
  if (result.kind !== "ok") {
    failures.push(`${label}: expected an ok result, got "${result.kind}"`);
    return null;
  }
  check(
    result.payload.status === expected,
    `${label}: expected status "${expected}", got "${result.payload.status}"`,
  );
  return result.payload;
}

async function run() {
  console.log("[test-b7] Starting (test companies will be deleted at the end)...\n");

  try {
    // ---- Part A: no deletion requested ----
    console.log("[test-b7] Part A: document with no deletion -> deletionRequested: false");
    const a = await setUpTwoFileDocument("no-deletion");
    const resultA = await getDeletionStatusByDocumentId({
      documentId: a.testDoc.id,
      companyId: a.testCompany.id,
    });
    const httpA = toHttpResponse(resultA);
    console.log("[test-b7][A] http:", httpA);
    check(resultA.kind === "no-deletion", `[A] expected kind "no-deletion", got "${resultA.kind}"`);
    check(httpA.status === 200, `[A] expected 200, got ${httpA.status}`);
    check(
      httpA.body.deletionRequested === false,
      "[A] expected deletionRequested: false in the body",
    );

    // ---- Part B: fresh request -> queued ----
    console.log("\n[test-b7] Part B: fresh request -> queued, 2 items reported");
    const b = await setUpTwoFileDocument("lifecycle");
    const requestB = await requestDeletionFor(b.testDoc.id, b.testCompany.id);
    const payloadB = await expectRequestStatus(requestB.id, b.testCompany.id, "queued", "[B]");
    console.log("[test-b7][B] status:", payloadB?.status, "items:", payloadB?.itemCount);
    check(payloadB?.itemCount === 2, `[B] expected 2 items, got ${payloadB?.itemCount}`);
    check(payloadB?.items.length === 2, `[B] expected 2 per-item entries, got ${payloadB?.items.length}`);
    check(payloadB?.purged === false, "[B] a live request must not report purged: true");

    const itemsB = await db
      .select()
      .from(storageDeletionItems)
      .where(eq(storageDeletionItems.requestId, BigInt(requestB.id)));
    const [item1, item2] = itemsB;

    // ---- Part C: partial, with per-item detail ----
    console.log("\n[test-b7] Part C: one item DELETED -> partial + per-item detail");
    await db
      .update(storageDeletionItems)
      .set({ itemState: "DELETED", lastError: null })
      .where(eq(storageDeletionItems.id, item1!.id));

    const payloadC = await expectRequestStatus(requestB.id, b.testCompany.id, "partial", "[C]");
    console.log("[test-b7][C] counts:", payloadC?.counts);
    console.log(
      "[test-b7][C] items:",
      payloadC?.items.map((i) => ({
        itemId: i.itemId,
        state: i.effectiveState,
        blocking: i.blockingCompletion,
      })),
    );
    // "partial" alone doesn't say which file is the problem — the detail must.
    const doneItem = payloadC?.items.find((i) => i.itemId === item1!.id);
    const pendingItem = payloadC?.items.find((i) => i.itemId === item2!.id);
    check(
      doneItem?.blockingCompletion === false,
      "[C] the DELETED item must not be reported as blocking completion",
    );
    check(
      pendingItem?.blockingCompletion === true,
      "[C] the not-yet-done item must be reported as blocking completion",
    );
    check(payloadC?.counts.DELETED === 1, `[C] expected DELETED count 1, got ${payloadC?.counts.DELETED}`);

    // ---- Part D: blocked -> manual_review ----
    console.log("\n[test-b7] Part D: remaining item BLOCKED -> manual_review");
    await db
      .update(storageDeletionItems)
      .set({ itemState: "BLOCKED", lastError: "forced by test", attempts: 5 })
      .where(eq(storageDeletionItems.id, item2!.id));
    const payloadD = await expectRequestStatus(
      requestB.id,
      b.testCompany.id,
      "manual_review",
      "[D]",
    );
    const blockedDetail = payloadD?.items.find((i) => i.itemId === item2!.id);
    check(
      blockedDetail?.lastError === "forced by test" && blockedDetail?.attempts === 5,
      "[D] per-item detail must surface lastError and attempts for the blocked item",
    );

    // ---- Part E: quarantined dominates ----
    console.log("\n[test-b7] Part E: remaining item QUARANTINED -> quarantined");
    await db
      .update(storageDeletionItems)
      .set({ itemState: "QUARANTINED" })
      .where(eq(storageDeletionItems.id, item2!.id));
    await expectRequestStatus(requestB.id, b.testCompany.id, "quarantined", "[E]");

    // ---- Part F: completed + purged, findable by BOTH ids ----
    console.log("\n[test-b7] Part F: completed + purged -> findable by request id AND document id");
    await db
      .update(storageDeletionItems)
      .set({ itemState: "DELETED", lastError: null })
      .where(eq(storageDeletionItems.requestId, BigInt(requestB.id)));
    await finalizeRequestIfDone(requestB.id);

    const liveRequests = await db
      .select()
      .from(storageDeletionRequests)
      .where(eq(storageDeletionRequests.id, requestB.id));
    check(
      liveRequests.length === 0,
      "[F] precondition: the request row should have been cascaded away by the purge",
    );

    // This is the lookup migration 0022 exists for.
    const payloadF1 = await expectRequestStatus(
      requestB.id,
      b.testCompany.id,
      "completed",
      "[F by request id]",
    );
    console.log("[test-b7][F] by request id:", {
      status: payloadF1?.status,
      purged: payloadF1?.purged,
      requestId: payloadF1?.requestId,
    });
    check(payloadF1?.purged === true, "[F] a tombstone answer must report purged: true");

    const resultF2 = await getDeletionStatusByDocumentId({
      documentId: b.testDoc.id,
      companyId: b.testCompany.id,
    });
    check(resultF2.kind === "ok", `[F by document id] expected ok, got "${resultF2.kind}"`);
    if (resultF2.kind === "ok") {
      console.log("[test-b7][F] by document id:", {
        status: resultF2.payload.status,
        purged: resultF2.payload.purged,
      });
      check(
        resultF2.payload.status === "completed",
        `[F by document id] expected "completed", got "${resultF2.payload.status}"`,
      );
      check(resultF2.payload.purged === true, "[F by document id] expected purged: true");
    }

    // ---- Part G: the worker persists "partial" ----
    console.log('\n[test-b7] Part G: finalizeRequestIfDone now persists "partial" to request.status');
    const g = await setUpTwoFileDocument("persist-partial");
    const requestG = await requestDeletionFor(g.testDoc.id, g.testCompany.id);
    const itemsG = await db
      .select()
      .from(storageDeletionItems)
      .where(eq(storageDeletionItems.requestId, BigInt(requestG.id)));
    await db
      .update(storageDeletionItems)
      .set({ itemState: "DELETED", lastError: null })
      .where(eq(storageDeletionItems.id, itemsG[0]!.id));

    await finalizeRequestIfDone(requestG.id);

    const [storedG] = await db
      .select()
      .from(storageDeletionRequests)
      .where(eq(storageDeletionRequests.id, requestG.id));
    console.log("[test-b7][G] stored request.status:", storedG?.status);
    check(
      storedG?.status === "partial",
      `[G] expected the worker to persist "partial", got "${storedG?.status}"`,
    );
    const payloadG = await expectRequestStatus(requestG.id, g.testCompany.id, "partial", "[G]");
    check(
      payloadG?.storedStatus === "partial",
      `[G] computed and stored status should now agree, got stored "${payloadG?.storedStatus}"`,
    );

    // ---- Part H: wrong company -> 404, not 403 ----
    console.log("\n[test-b7] Part H: wrong company -> 404 (non-disclosure)");
    const otherCompany = await makeCompany("other");
    const resultH = await getDeletionStatusByRequestId({
      requestId: requestG.id,
      companyId: otherCompany.id,
    });
    const httpH = toHttpResponse(resultH);
    console.log("[test-b7][H] http:", httpH);
    check(resultH.kind === "forbidden", `[H] expected kind "forbidden", got "${resultH.kind}"`);
    check(httpH.status === 404, `[H] expected 404 (not 403), got ${httpH.status}`);

    // ---- Part I: nonexistent id -> 404 ----
    console.log("\n[test-b7] Part I: nonexistent request id -> 404");
    const resultI = await getDeletionStatusByRequestId({
      requestId: 999_999_999,
      companyId: g.testCompany.id,
    });
    const httpI = toHttpResponse(resultI);
    console.log("[test-b7][I] http:", httpI);
    check(httpI.status === 404, `[I] expected 404, got ${httpI.status}`);

    // ---- Pure checks on the status roll-up ----
    console.log("\n[test-b7] Pure: computeRequestStatus severity order");
    check(computeRequestStatus(["DELETED", "DELETED"]) === "completed", "[pure] all terminal -> completed");
    check(computeRequestStatus(["DELETED", "PENDING"]) === "partial", "[pure] mixed -> partial");
    check(computeRequestStatus(["PENDING", "PENDING"]) === "queued", "[pure] none terminal -> queued");
    check(
      computeRequestStatus(["DELETED", "BLOCKED"]) === "manual_review",
      "[pure] blocked outranks partial",
    );
    check(
      computeRequestStatus(["BLOCKED", "QUARANTINED"]) === "quarantined",
      "[pure] quarantined dominates manual_review",
    );
    check(computeRequestStatus(["NOT_FOUND"]) === "completed", "[pure] NOT_FOUND counts as terminal");

    // ---- Report ----
    if (failures.length > 0) {
      console.error("\n[test-b7] FAILURES:");
      for (const f of failures) console.error(`  - ${f}`);
      process.exitCode = 1;
    } else {
      console.log("\n[test-b7] All assertions passed.");
    }
  } finally {
    for (const id of companyIdsToCleanUp) {
      await db
        .delete(storageDeletionTombstones)
        .where(eq(storageDeletionTombstones.companyId, BigInt(id)));
      await db.delete(company).where(eq(company.id, id));
      console.log(`[test-b7] cleaned up test company id=${id}`);
    }
  }
}

run()
  .then(() => {
    console.log("[test-b7] Done.");
    process.exit(process.exitCode ?? 0);
  })
  .catch((err) => {
    console.error("[test-b7] Unexpected error:", err);
    process.exit(1);
  });
