/**
 * Manual test for B6 (serve-gating), run against the real local Postgres.
 *
 * The design doc's test bullet is the interesting one: "a document
 * mid-deletion or quarantined cannot be fetched via any read path, even if
 * relational rows still exist." Two things follow from that, and this script
 * checks both:
 *
 *   1. The gate must key off deletion STATUS, not row presence. Several parts
 *      below assert the document row is still physically there at the moment
 *      the gate refuses — that's the whole point of the window B6 closes.
 *   2. "any read path" means one route quietly still serving would be a
 *      failure even if the shared check is perfect. Part J is a static check
 *      that all four content routes actually import and call the gate, which
 *      no amount of testing the function in isolation would catch.
 *
 * Covers:
 *   Part A — fresh document, no deletion -> servable (the gate doesn't break
 *            normal traffic)
 *   Part B — delete requested -> 410 delete_requested, document row STILL EXISTS
 *   Part C — provider call in flight (object STORAGE_DELETING) -> 410 storage_deleting
 *   Part D — item BLOCKED -> 410 blocked
 *   Part E — item QUARANTINED -> 410 quarantined (dominates, per Decision 6)
 *   Part F — CANCELLED request -> servable again. Regression guard: cancel
 *            deliberately leaves the request row forever, so a naive gate
 *            would turn cancellation into a permanent soft-delete.
 *   Part G — LEGACY document (no manifest, so no storage_objects rows at all)
 *            -> still gated. This is why the gate reads deletion items rather
 *            than lifecycleState; a lifecycleState-driven gate would pass
 *            every other part of this script and silently fail here.
 *   Part H — checkRefServable by (adapter, key) -> 410, the /api/files/[id]
 *            path which never sees a documentId
 *   Part I — fully deleted document (tombstone, rows purged) -> 410 already_deleted
 *   Part J — static: all four gated routes import the shared check
 *
 * Run with:
 *   pnpm tsx scripts/test-serve-gating.ts
 */

import "dotenv/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import {
  company,
  document,
  fileUploads,
  storageObjects,
  storageDeletionItems,
  storageDeletionTombstones,
} from "@launchstack/core/db/schema";

import { db } from "../src/server/db";
import { registerObject } from "../src/server/services/storage-manifest";
import {
  requestDocumentDeletion,
  cancelDeletionRequest,
} from "../src/server/services/storage-deletion-coordinator";
import { finalizeRequestIfDone } from "../src/server/inngest/functions/storageDeletionWorker";
import {
  checkDocumentServable,
  checkRefServable,
  type ServeRefusalReason,
} from "../src/server/services/document-servable";

const failures: string[] = [];
const companyIdsToCleanUp: number[] = [];

function check(condition: boolean, label: string) {
  if (!condition) failures.push(label);
}

/** Asserts a refusal with the expected reason and a 410. */
async function expectRefused(
  docId: number,
  reason: ServeRefusalReason,
  label: string,
) {
  const verdict = await checkDocumentServable(docId);
  check(
    verdict.servable === false,
    `${label}: expected NOT servable, got servable=${verdict.servable}`,
  );
  check(
    verdict.reason === reason,
    `${label}: expected reason "${reason}", got "${verdict.reason}"`,
  );
  check(verdict.status === 410, `${label}: expected status 410, got ${verdict.status}`);
  return verdict;
}

/** The row is still physically present — existence must not imply servability. */
async function expectDocumentRowStillExists(docId: number, label: string) {
  const rows = await db.select({ id: document.id }).from(document).where(eq(document.id, docId));
  check(
    rows.length === 1,
    `${label}: expected the document row to still exist while gated, found ${rows.length}`,
  );
}

async function makeCompany(label: string) {
  const [testCompany] = await db
    .insert(company)
    .values({ name: `B6 test company (${label})`, numberOfEmployees: "1" })
    .returning();
  if (!testCompany) throw new Error("failed to insert test company");
  companyIdsToCleanUp.push(testCompany.id);
  return testCompany;
}

/** Manifest-backed document: has a real storage_objects row. */
async function setUpManifestDocument(label: string) {
  const testCompany = await makeCompany(label);

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

  const [testDoc] = await db
    .insert(document)
    .values({
      url: `/api/files/${upload.id}`,
      category: "test",
      title: `B6 test document (${label})`,
      companyId: BigInt(testCompany.id),
    })
    .returning();
  if (!testDoc) throw new Error("failed to insert test document");

  const obj = await db.transaction(async (tx) =>
    registerObject(tx, {
      adapter: "database",
      storageLocationId: "database:default",
      key: String(upload.id),
      companyId: testCompany.id,
      documentId: testDoc.id,
      contentType: "application/pdf",
      sizeBytes: upload.fileSize,
    }),
  );

  return { testCompany, testDoc, upload, obj };
}

/**
 * Legacy document: NO manifest row at all, so nothing anywhere carries a
 * lifecycleState for it. Its url promotes to a database-adapter ref.
 */
async function setUpLegacyDocument(label: string) {
  const testCompany = await makeCompany(label);
  const [testDoc] = await db
    .insert(document)
    .values({
      url: "https://legacy.example.test/api/files/970001",
      category: "test",
      title: `B6 legacy document (${label})`,
      companyId: BigInt(testCompany.id),
    })
    .returning();
  if (!testDoc) throw new Error("failed to insert legacy test document");
  return { testCompany, testDoc };
}

async function requestDeletionFor(docId: number, companyId: number) {
  // Direct, not via the dispatch wrapper — this test is about the gate, and
  // shouldn't depend on Inngest being reachable.
  return db.transaction(async (tx) =>
    requestDocumentDeletion(tx, { docId, companyId, actorId: "test-script" }),
  );
}

async function run() {
  console.log("[test-b6] Starting (test companies will be deleted at the end)...\n");

  try {
    // ---- Part A: no deletion -> servable ----
    console.log("[test-b6] Part A: fresh document -> servable");
    const a = await setUpManifestDocument("servable");
    const verdictA = await checkDocumentServable(a.testDoc.id);
    console.log("[test-b6][A] verdict:", verdictA);
    check(verdictA.servable === true, "[A] a document with no deletion request must be servable");

    // ---- Part B: delete requested ----
    console.log("\n[test-b6] Part B: delete requested -> 410, row still exists");
    const b = await setUpManifestDocument("delete-requested");
    const requestB = await requestDeletionFor(b.testDoc.id, b.testCompany.id);
    const verdictB = await expectRefused(b.testDoc.id, "delete_requested", "[B]");
    console.log("[test-b6][B] verdict:", verdictB);
    await expectDocumentRowStillExists(b.testDoc.id, "[B]");

    // ---- Part C: provider call in flight ----
    console.log("\n[test-b6] Part C: object STORAGE_DELETING -> 410 storage_deleting");
    await db
      .update(storageObjects)
      .set({ lifecycleState: "STORAGE_DELETING" })
      .where(eq(storageObjects.id, b.obj.id));
    const verdictC = await expectRefused(b.testDoc.id, "storage_deleting", "[C]");
    console.log("[test-b6][C] verdict:", verdictC);
    await expectDocumentRowStillExists(b.testDoc.id, "[C]");

    // ---- Part D: blocked ----
    console.log("\n[test-b6] Part D: item BLOCKED -> 410 blocked");
    await db
      .update(storageDeletionItems)
      .set({ itemState: "BLOCKED", lastError: "forced by test" })
      .where(eq(storageDeletionItems.requestId, BigInt(requestB.id)));
    await db
      .update(storageObjects)
      .set({ lifecycleState: "BLOCKED" })
      .where(eq(storageObjects.id, b.obj.id));
    const verdictD = await expectRefused(b.testDoc.id, "blocked", "[D]");
    console.log("[test-b6][D] verdict:", verdictD);

    // ---- Part E: quarantined dominates ----
    console.log("\n[test-b6] Part E: item QUARANTINED -> 410 quarantined");
    await db
      .update(storageDeletionItems)
      .set({ itemState: "QUARANTINED", lastError: "forced by test" })
      .where(eq(storageDeletionItems.requestId, BigInt(requestB.id)));
    const verdictE = await expectRefused(b.testDoc.id, "quarantined", "[E]");
    console.log("[test-b6][E] verdict:", verdictE);
    await expectDocumentRowStillExists(b.testDoc.id, "[E]");

    // ---- Part F: cancelled -> servable again ----
    console.log("\n[test-b6] Part F: cancelled request -> servable again (not a soft delete)");
    const f = await setUpManifestDocument("cancelled");
    const requestF = await requestDeletionFor(f.testDoc.id, f.testCompany.id);
    await expectRefused(f.testDoc.id, "delete_requested", "[F pre-cancel]");
    await cancelDeletionRequest(requestF.id, "test-script");
    const verdictF = await checkDocumentServable(f.testDoc.id);
    console.log("[test-b6][F] verdict after cancel:", verdictF);
    check(
      verdictF.servable === true,
      `[F] a cancelled deletion must not keep gating the document (got reason "${verdictF.reason}") — otherwise cancel is a permanent soft delete`,
    );

    // ---- Part G: legacy document, no manifest anywhere ----
    console.log("\n[test-b6] Part G: legacy document (no storage_objects at all) -> still gated");
    const g = await setUpLegacyDocument("legacy");
    const objectsForG = await db
      .select()
      .from(storageObjects)
      .where(eq(storageObjects.companyId, BigInt(g.testCompany.id)));
    check(
      objectsForG.length === 0,
      `[G] precondition: legacy document must have no storage_objects rows, found ${objectsForG.length}`,
    );
    await requestDeletionFor(g.testDoc.id, g.testCompany.id);
    const verdictG = await expectRefused(g.testDoc.id, "delete_requested", "[G]");
    console.log("[test-b6][G] verdict:", verdictG);
    await expectDocumentRowStillExists(g.testDoc.id, "[G]");

    // ---- Part H: by ref, the /api/files/[id] path ----
    console.log("\n[test-b6] Part H: checkRefServable by (adapter, key) -> 410");
    const h = await setUpManifestDocument("by-ref");
    await requestDeletionFor(h.testDoc.id, h.testCompany.id);
    const verdictH = await checkRefServable([
      { adapter: "database", key: String(h.upload.id) },
    ]);
    console.log("[test-b6][H] verdict:", verdictH);
    check(verdictH.servable === false, "[H] a file covered by an open deletion item must not be servable");
    check(verdictH.status === 410, `[H] expected status 410, got ${verdictH.status}`);

    const verdictHUnrelated = await checkRefServable([
      { adapter: "database", key: "999999999" },
    ]);
    check(
      verdictHUnrelated.servable === true,
      "[H] an unrelated file must stay servable (the ref gate must not over-match)",
    );

    // ---- Part I: fully deleted -> tombstone ----
    console.log("\n[test-b6] Part I: fully deleted document -> 410 already_deleted");
    const i = await setUpManifestDocument("purged");
    const requestI = await requestDeletionFor(i.testDoc.id, i.testCompany.id);
    // Stand in for the worker succeeding (database adapter is Dev A's A3).
    await db.delete(fileUploads).where(eq(fileUploads.id, i.upload.id));
    await db
      .update(storageDeletionItems)
      .set({ itemState: "DELETED", lastError: null })
      .where(eq(storageDeletionItems.requestId, BigInt(requestI.id)));
    await finalizeRequestIfDone(requestI.id);

    const rowsAfterPurge = await db
      .select({ id: document.id })
      .from(document)
      .where(eq(document.id, i.testDoc.id));
    check(rowsAfterPurge.length === 0, "[I] precondition: the document should have been purged");

    const verdictI = await expectRefused(i.testDoc.id, "already_deleted", "[I]");
    console.log("[test-b6][I] verdict:", verdictI);

    // ---- Part J: every gated route actually calls the shared check ----
    console.log("\n[test-b6] Part J: static — all four content routes call the shared gate");
    const gatedRoutes = [
      "src/app/api/files/[id]/route.ts",
      "src/app/api/documents/[id]/content/route.ts",
      "src/app/api/documents/[id]/text/route.ts",
      "src/app/api/documents/[id]/versions/[versionId]/content/route.ts",
    ];
    for (const route of gatedRoutes) {
      let source: string;
      try {
        source = readFileSync(join(process.cwd(), route), "utf8");
      } catch {
        failures.push(`[J] could not read ${route} — run this from apps/web`);
        continue;
      }
      const imports = source.includes("server/services/document-servable");
      const calls = /check(Document|Version|Ref)Servable\s*\(/.test(source);
      check(imports, `[J] ${route} does not import the shared serve-gate`);
      check(calls, `[J] ${route} imports the gate but never calls it`);
      console.log(`[test-b6][J] ${imports && calls ? "OK  " : "FAIL"} ${route}`);
    }

    // ---- Report ----
    if (failures.length > 0) {
      console.error("\n[test-b6] FAILURES:");
      for (const f of failures) console.error(`  - ${f}`);
      process.exitCode = 1;
    } else {
      console.log("\n[test-b6] All assertions passed.");
    }
  } finally {
    // Tombstones have no FK to document, so they survive the company cascade.
    for (const id of companyIdsToCleanUp) {
      await db
        .delete(storageDeletionTombstones)
        .where(eq(storageDeletionTombstones.companyId, BigInt(id)));
      await db.delete(company).where(eq(company.id, id));
      console.log(`[test-b6] cleaned up test company id=${id}`);
    }
  }
}

run()
  .then(() => {
    console.log("[test-b6] Done.");
    process.exit(process.exitCode ?? 0);
  })
  .catch((err) => {
    console.error("[test-b6] Unexpected error:", err);
    process.exit(1);
  });
