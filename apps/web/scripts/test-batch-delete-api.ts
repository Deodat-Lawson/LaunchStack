/**
 * Manual test for B5 (batch delete + cross-document ref dedup), run against
 * the real local Postgres. Same approach as the B2/B3/B4 scripts: call the
 * plain functions the route delegates to, since Clerk auth can't be
 * exercised from a script.
 *
 * All test documents use a legacy-style URL (https://.../api/files/<n>),
 * which promoteLegacyUrlToRef resolves to a "database"-adapter ref without
 * needing any S3/Blob env config. They deliberately have NO manifest row, so
 * the legacy-fallback path runs — which is the only path where two documents
 * can reference the same physical file, and therefore the only path where
 * dedup does anything.
 *
 * Covers:
 *   Part A — flag off -> 503, nothing created
 *   Part B — the dedup plan: doc1 and doc2 share a file, doc3 is unique,
 *            doc4 and doc5 share an UNRESOLVABLE url. Asserts exactly one
 *            PENDING item exists for the shared file, that doc2's item is
 *            LINKED and points at doc1's item, and that the two quarantined
 *            documents are NOT deduped against each other (each needs its
 *            own QUARANTINED item so its own request status is right).
 *   Part C — dynamic LINKED resolution: with the leader item forced to
 *            BLOCKED, finalizing the FOLLOWER's request must see it as
 *            non-terminal and set that request to manual_review — i.e. the
 *            follower reads the leader's state live, it never holds a stale
 *            copy.
 *   Part D — purge-time materialization, the whole point of the exercise:
 *            with the leader item DELETED, finalizing the LEADER's request
 *            purges doc1 and cascades its items away. Asserts the follower
 *            got the leader's outcome copied onto it BEFORE that cascade
 *            (state DELETED, linkedToItemId cleared), and that doc2's own
 *            request was then finalized and purged too — nothing is left
 *            hanging on a row that no longer exists.
 *   Part E — rollUpBatchStatus, Decision 6a's batch rule, as a pure check.
 *   Part F — handleBatchDeleteDocumentsRequest end to end on a mixed batch
 *            (one already-tombstoned document + one fresh one). Like the B4
 *            script's Part B this calls inngest.send for real, so it accepts
 *            BOTH correct outcomes: 202 "partial" if Inngest is reachable,
 *            or a thrown DispatchFailedError with a fully clean rollback if
 *            it isn't. What would FAIL is a 202 with no request written, or
 *            a failure that left request rows behind.
 *
 * Run with:
 *   pnpm tsx scripts/test-batch-delete-api.ts
 */

import "dotenv/config";
import { eq, inArray } from "drizzle-orm";
import {
  company,
  document,
  storageDeletionRequests,
  storageDeletionItems,
  storageDeletionTombstones,
} from "@launchstack/core/db/schema";

import { db } from "../src/server/db";
import {
  requestBatchDocumentDeletion,
  type BatchDeletionEntry,
} from "../src/server/services/storage-deletion-coordinator";
import { finalizeRequestIfDone } from "../src/server/inngest/functions/storageDeletionWorker";
import {
  handleBatchDeleteDocumentsRequest,
  rollUpBatchStatus,
} from "../src/server/services/batch-delete-documents-api";

const failures: string[] = [];
const companyIdsToCleanUp: number[] = [];

function check(condition: boolean, label: string) {
  if (!condition) failures.push(label);
}

/** Resolves to a database-adapter ref with key "<n>" — no env config needed. */
const sharedUrl = "https://legacy.example.test/api/files/900001";
const uniqueUrl = "https://legacy.example.test/api/files/900002";
/** Matches no adapter pattern -> promotion fails -> QUARANTINED item. */
const unresolvableUrl = "https://legacy.example.test/not/a/known/storage/path";

async function makeCompany(label: string) {
  const [testCompany] = await db
    .insert(company)
    .values({ name: `B5 test company (${label})`, numberOfEmployees: "1" })
    .returning();
  if (!testCompany) throw new Error("failed to insert test company");
  companyIdsToCleanUp.push(testCompany.id);
  return testCompany;
}

async function makeDoc(companyId: number, label: string, url: string) {
  const [testDoc] = await db
    .insert(document)
    .values({
      url,
      category: "test",
      title: `B5 test document (${label})`,
      companyId: BigInt(companyId),
    })
    .returning();
  if (!testDoc) throw new Error(`failed to insert test document ${label}`);
  return testDoc;
}

async function itemsFor(requestId: number) {
  return db
    .select()
    .from(storageDeletionItems)
    .where(eq(storageDeletionItems.requestId, BigInt(requestId)));
}

function entryFor(entries: BatchDeletionEntry[], docId: number): BatchDeletionEntry {
  const found = entries.find((e) => e.docId === docId);
  if (!found) throw new Error(`no batch entry for document ${docId}`);
  return found;
}

async function run() {
  console.log("[test-b5] Starting (test companies will be deleted at the end)...\n");

  try {
    // ---- Part A: flag off ----
    console.log("[test-b5] Part A: flag off -> 503");
    process.env.STORAGE_DELETION_LIFECYCLE_ENABLED = "false";
    const flagCompany = await makeCompany("flag-off");
    const flagDoc = await makeDoc(flagCompany.id, "flag-off", uniqueUrl);
    const resultA = await handleBatchDeleteDocumentsRequest({
      documentIds: [flagDoc.id],
      companyId: flagCompany.id,
      actorId: "test-script",
    });
    console.log("[test-b5][A] result:", resultA);
    check(resultA.status === 503, `[A] expected status 503, got ${resultA.status}`);
    const leakedA = await db
      .select()
      .from(storageDeletionRequests)
      .where(eq(storageDeletionRequests.documentId, BigInt(flagDoc.id)));
    check(leakedA.length === 0, `[A] flag off must create nothing, found ${leakedA.length} request(s)`);

    process.env.STORAGE_DELETION_LIFECYCLE_ENABLED = "true";

    // ---- Part B: the dedup plan ----
    console.log("\n[test-b5] Part B: dedup plan (shared file -> one leader, one follower)");
    const batchCompany = await makeCompany("dedup");
    const doc1 = await makeDoc(batchCompany.id, "leader", sharedUrl);
    const doc2 = await makeDoc(batchCompany.id, "follower", sharedUrl);
    const doc3 = await makeDoc(batchCompany.id, "unique", uniqueUrl);
    const doc4 = await makeDoc(batchCompany.id, "quarantine-a", unresolvableUrl);
    const doc5 = await makeDoc(batchCompany.id, "quarantine-b", unresolvableUrl);

    const entries = await db.transaction(async (tx) =>
      requestBatchDocumentDeletion(tx, {
        docIds: [doc5.id, doc1.id, doc4.id, doc2.id, doc3.id], // deliberately unsorted
        companyId: batchCompany.id,
        actorId: "test-script",
      }),
    );

    check(entries.length === 5, `[B] expected 5 batch entries, got ${entries.length}`);

    const leaderEntry = entryFor(entries, doc1.id);
    const followerEntry = entryFor(entries, doc2.id);
    const uniqueEntry = entryFor(entries, doc3.id);

    const leaderItems = await itemsFor(leaderEntry.request.id);
    const followerItems = await itemsFor(followerEntry.request.id);
    const uniqueItems = await itemsFor(uniqueEntry.request.id);
    const q1Items = await itemsFor(entryFor(entries, doc4.id).request.id);
    const q2Items = await itemsFor(entryFor(entries, doc5.id).request.id);

    check(leaderItems.length === 1, `[B] leader expected 1 item, got ${leaderItems.length}`);
    check(followerItems.length === 1, `[B] follower expected 1 item, got ${followerItems.length}`);

    const leaderItem = leaderItems[0]!;
    const followerItem = followerItems[0]!;

    // Lowest document id in the batch wins the file, regardless of the order
    // the ids were passed in.
    check(
      leaderItem.itemState === "PENDING" && leaderItem.linkedToItemId === null,
      `[B] leader item should be PENDING with no link, got ${leaderItem.itemState}/${leaderItem.linkedToItemId}`,
    );
    check(
      followerItem.itemState === "LINKED",
      `[B] follower item should be LINKED, got ${followerItem.itemState}`,
    );
    check(
      followerItem.linkedToItemId !== null &&
        Number(followerItem.linkedToItemId) === leaderItem.id,
      `[B] follower should point at leader item ${leaderItem.id}, got ${followerItem.linkedToItemId}`,
    );
    check(
      followerEntry.linkedItemCount === 1 && leaderEntry.linkedItemCount === 0,
      `[B] expected linkedItemCount 0 for leader / 1 for follower, got ${leaderEntry.linkedItemCount}/${followerEntry.linkedItemCount}`,
    );

    // The whole point: exactly ONE real delete call will be made for the
    // shared file, across the entire batch.
    const allBatchItems = await db
      .select()
      .from(storageDeletionItems)
      .where(
        inArray(
          storageDeletionItems.requestId,
          entries.map((e) => BigInt(e.request.id)),
        ),
      );
    const pendingForSharedFile = allBatchItems.filter(
      (item) => item.itemState === "PENDING" && item.key === "900001",
    );
    check(
      pendingForSharedFile.length === 1,
      `[B] expected exactly 1 PENDING item for the shared file, got ${pendingForSharedFile.length}`,
    );

    // A document that shares nothing is untouched by dedup.
    check(
      uniqueItems.length === 1 && uniqueItems[0]!.itemState === "PENDING",
      `[B] unique document should have 1 PENDING item, got ${uniqueItems.length}/${uniqueItems[0]?.itemState}`,
    );

    // Quarantined items are deliberately NOT deduped — each document needs
    // its own, so each request's status is independently correct.
    check(
      q1Items.length === 1 && q1Items[0]!.itemState === "QUARANTINED",
      `[B] doc4 should have its own QUARANTINED item, got ${q1Items[0]?.itemState}`,
    );
    check(
      q2Items.length === 1 && q2Items[0]!.itemState === "QUARANTINED",
      `[B] doc5 should have its own QUARANTINED item (not LINKED), got ${q2Items[0]?.itemState}`,
    );
    check(
      entryFor(entries, doc4.id).request.status === "quarantined" &&
        entryFor(entries, doc5.id).request.status === "quarantined",
      "[B] both unresolvable-url documents should have request status 'quarantined'",
    );

    // ---- Part C: dynamic LINKED resolution ----
    console.log("\n[test-b5] Part C: follower reads the leader's state live (leader BLOCKED -> follower manual_review)");
    await db
      .update(storageDeletionItems)
      .set({ itemState: "BLOCKED", lastError: "forced by test" })
      .where(eq(storageDeletionItems.id, leaderItem.id));

    const finalizeC = await finalizeRequestIfDone(followerEntry.request.id);
    console.log("[test-b5][C] finalize(follower):", finalizeC);
    check(
      finalizeC.allTerminal === false && finalizeC.anyBlocked === true,
      `[C] follower should be non-terminal and blocked via its leader, got allTerminal=${finalizeC.allTerminal} anyBlocked=${finalizeC.anyBlocked}`,
    );
    const [followerRequestAfterC] = await db
      .select()
      .from(storageDeletionRequests)
      .where(eq(storageDeletionRequests.id, followerEntry.request.id));
    check(
      followerRequestAfterC?.status === "manual_review",
      `[C] follower request should be manual_review, got "${followerRequestAfterC?.status}"`,
    );
    // The follower's own row must NOT have been rewritten — the leader's
    // state is read live, never copied early.
    const [followerItemAfterC] = await db
      .select()
      .from(storageDeletionItems)
      .where(eq(storageDeletionItems.id, followerItem.id));
    check(
      followerItemAfterC?.itemState === "LINKED",
      `[C] follower item should still be LINKED (no early copy), got "${followerItemAfterC?.itemState}"`,
    );

    // ---- Part D: purge-time materialization ----
    console.log("\n[test-b5] Part D: leader purges -> outcome materialized onto follower, follower finalized too");
    // Stand in for the worker actually succeeding (the database adapter is
    // Dev A's A3 and is still deliberately BLOCKED in this worker).
    await db
      .update(storageDeletionItems)
      .set({ itemState: "DELETED", lastError: null })
      .where(eq(storageDeletionItems.id, leaderItem.id));

    const finalizeD = await finalizeRequestIfDone(leaderEntry.request.id);
    console.log("[test-b5][D] finalize(leader):", finalizeD);

    check(finalizeD.purged === true, "[D] leader's document should have been purged");
    check(
      finalizeD.materializedFollowerRequestIds.includes(followerEntry.request.id),
      `[D] expected follower request ${followerEntry.request.id} in materializedFollowerRequestIds, got ${JSON.stringify(finalizeD.materializedFollowerRequestIds)}`,
    );

    // The leader's rows are gone (cascaded by the document purge)...
    const leaderItemsAfter = await db
      .select()
      .from(storageDeletionItems)
      .where(eq(storageDeletionItems.id, leaderItem.id));
    check(leaderItemsAfter.length === 0, "[D] leader item should have been cascaded away with its document");

    // ...and both documents are actually purged, each with a tombstone.
    const survivingDocs = await db
      .select({ id: document.id })
      .from(document)
      .where(inArray(document.id, [doc1.id, doc2.id]));
    check(
      survivingDocs.length === 0,
      `[D] both the leader's and the follower's documents should be purged, ${survivingDocs.length} survived`,
    );

    const tombstones = await db
      .select()
      .from(storageDeletionTombstones)
      .where(
        inArray(storageDeletionTombstones.documentId, [BigInt(doc1.id), BigInt(doc2.id)]),
      );
    check(
      tombstones.length === 2,
      `[D] expected a tombstone for both documents, got ${tombstones.length}`,
    );
    check(
      tombstones.every((t) => t.finalStatus === "completed"),
      "[D] both tombstones should record finalStatus 'completed'",
    );

    // ---- Part E: Decision 6a batch roll-up ----
    console.log("\n[test-b5] Part E: rollUpBatchStatus (Decision 6a)");
    check(
      rollUpBatchStatus(["completed", "completed"]) === "completed",
      "[E] all completed -> completed",
    );
    check(
      rollUpBatchStatus(["completed", "queued"]) === "partial",
      "[E] >=1 completed and >=1 not -> partial",
    );
    check(rollUpBatchStatus(["queued", "queued"]) === "queued", "[E] none completed -> queued");
    check(
      rollUpBatchStatus(["queued", "manual_review", "quarantined"]) === "quarantined",
      "[E] quarantined dominates manual_review",
    );
    check(
      rollUpBatchStatus(["queued", "manual_review"]) === "manual_review",
      "[E] manual_review when nothing quarantined and nothing completed",
    );

    // ---- Part F: mixed batch through the real API handler ----
    console.log("\n[test-b5] Part F: mixed batch (one tombstoned + one fresh) -> 202 partial, or clean rollback");
    const freshDoc = await makeDoc(batchCompany.id, "mixed-fresh", uniqueUrl);
    let resultF: { status: number; body: Record<string, unknown> };
    try {
      // doc1 is already tombstoned by Part D, so it's answered from the
      // tombstone and never re-planned.
      resultF = await handleBatchDeleteDocumentsRequest({
        documentIds: [doc1.id, freshDoc.id],
        companyId: batchCompany.id,
        actorId: "test-script",
      });
    } catch (err) {
      resultF = {
        status: 500,
        body: { error: err instanceof Error ? err.message : String(err) },
      };
    }
    console.log("[test-b5][F] result:", resultF);

    if (resultF.status === 202) {
      check(
        resultF.body.status === "partial",
        `[F] expected batch status "partial" (one completed, one queued), got "${resultF.body.status}"`,
      );
      check(resultF.body.accepted === 1, `[F] expected accepted=1, got ${resultF.body.accepted}`);
      check(
        resultF.body.alreadyCompleted === 1,
        `[F] expected alreadyCompleted=1, got ${resultF.body.alreadyCompleted}`,
      );
      const freshRequests = await db
        .select()
        .from(storageDeletionRequests)
        .where(eq(storageDeletionRequests.documentId, BigInt(freshDoc.id)));
      check(freshRequests.length === 1, `[F] expected 1 request for the fresh document, got ${freshRequests.length}`);
    } else if (resultF.status === 500) {
      console.log("[test-b5][F] Inngest unreachable here — verifying the whole batch rolled back cleanly");
      const freshRequests = await db
        .select()
        .from(storageDeletionRequests)
        .where(eq(storageDeletionRequests.documentId, BigInt(freshDoc.id)));
      check(
        freshRequests.length === 0,
        `[F] expected no leftover request after rollback, found ${freshRequests.length}`,
      );
    } else {
      failures.push(`[F] unexpected status ${resultF.status} — expected 202 or 500`);
    }

    // ---- Report ----
    if (failures.length > 0) {
      console.error("\n[test-b5] FAILURES:");
      for (const f of failures) console.error(`  - ${f}`);
      process.exitCode = 1;
    } else {
      console.log("\n[test-b5] All assertions passed.");
    }
  } finally {
    // Tombstones deliberately have no FK to document, so they survive the
    // company cascade — clean them up explicitly.
    await db
      .delete(storageDeletionTombstones)
      .where(
        inArray(
          storageDeletionTombstones.companyId,
          companyIdsToCleanUp.map((id) => BigInt(id)),
        ),
      );
    for (const id of companyIdsToCleanUp) {
      await db.delete(company).where(eq(company.id, id));
      console.log(`[test-b5] cleaned up test company id=${id}`);
    }
  }
}

run()
  .then(() => {
    console.log("[test-b5] Done.");
    process.exit(process.exitCode ?? 0);
  })
  .catch((err) => {
    console.error("[test-b5] Unexpected error:", err);
    process.exit(1);
  });
