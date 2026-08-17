"""B7 in-place edits: tombstone FK removal in the Drizzle schema, and the
worker persisting "partial". Idempotent."""
import sys, os

ROOT = os.path.expanduser("~/mnt/launchstack/LaunchStack")

BASE_OLD = '''        requestId: bigint("request_id", { mode: "bigint" }).references(
            () => storageDeletionRequests.id,
            { onDelete: "set null" }
        ),'''

BASE_NEW = '''        // Intentionally NOT a real FK (migration 0022) — same reasoning as
        // document_id below, which the original version of this table applied
        // to that column but missed here. storage_deletion_requests.document_id
        // is ON DELETE CASCADE against document.id, so completing a deletion
        // destroys the request row; an FK here would then null out the
        // tombstone's only pointer back to it, at exactly the moment someone
        // holding a request id wants to ask what happened (B7).
        requestId: bigint("request_id", { mode: "bigint" }),'''

WORKER_OLD = '''      await db
        .update(storageDeletionRequests)
        .set({ status: "manual_review" })
        .where(eq(storageDeletionRequests.id, requestId));
    }
    return {'''

WORKER_NEW = '''      await db
        .update(storageDeletionRequests)
        .set({ status: "manual_review" })
        .where(eq(storageDeletionRequests.id, requestId));
    } else if (
      allItems.some(
        (item) => stateOf(item) === "DELETED" || stateOf(item) === "NOT_FOUND",
      )
    ) {
      // Some items are done and some aren't, with nothing blocked or
      // quarantined outranking that: Decision 6a's "partial", applied at the
      // request level rather than the batch level. Nothing wrote this status
      // before B7 — without it the maintained summary column can never
      // represent the one state the status API most needs to explain, and
      // the read API would be silently correcting the stored value on every
      // poll.
      await db
        .update(storageDeletionRequests)
        .set({ status: "partial" })
        .where(eq(storageDeletionRequests.id, requestId));
    }
    return {'''

EDITS = [
    ("packages/core/src/db/schema/base.ts", BASE_OLD, BASE_NEW, "migration 0022"),
    ("apps/web/src/server/inngest/functions/storageDeletionWorker.ts",
     WORKER_OLD, WORKER_NEW, 'Decision 6a\'s "partial"'),
]

failures = []
for rel, old, new, marker in EDITS:
    full = os.path.join(ROOT, rel)
    raw = open(full, "rb").read()
    crlf = b"\r\n" in raw
    s = raw.decode("utf-8").replace("\r\n", "\n")

    if marker in s:
        print(f"SKIP (already patched): {rel}")
        continue

    n = s.count(old)
    if n != 1:
        failures.append(f"{rel}: anchor matched {n} times (expected 1)")
        continue

    s = s.replace(old, new, 1)
    out = s.replace("\n", "\r\n") if crlf else s
    open(full, "wb").write(out.encode("utf-8"))
    print(f"PATCHED: {rel} (crlf={crlf})")

if failures:
    print("\nFAILURES:")
    for f in failures:
        print("  -", f)
    sys.exit(1)
print("\nb7 patches applied")
