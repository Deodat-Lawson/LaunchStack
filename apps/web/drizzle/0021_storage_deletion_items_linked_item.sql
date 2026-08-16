-- Storage deletion lifecycle — cross-document ref dedup (B5).
--
-- Two documents in the same batch delete can legitimately reference the
-- SAME physical file. This only happens on the legacy-fallback path:
-- manifest-backed objects are exclusively owned by exactly one target
-- (enforced by storage_objects' exactly-one-owner CHECK), but a pre-manifest
-- document's refs are scavenged from raw URL columns, and two documents can
-- coincidentally carry the same URL.
--
-- Rather than issue two independent delete calls for one file (and rely on
-- idempotency to make the second one harmless), the batch coordinator picks
-- one "leader" item that actually performs the delete, and gives every other
-- document referencing that file a "follower" item pointing at the leader
-- via linked_to_item_id. A follower is a real audit row — same adapter /
-- storage_location_id / key — it just never independently calls a provider.
--
-- ON DELETE SET NULL, not CASCADE: when a leader's document is purged, its
-- request and items cascade away. A follower must survive that (it belongs
-- to a different document, which may not be purged) — so the pointer is
-- nulled rather than the row destroyed. The worker materializes the leader's
-- final state onto its followers *before* that cascade happens, so a NULL
-- pointer here never means "outcome lost".
--
-- No new enum constraint is needed for the LINKED item_state: item_state is
-- a plain varchar(32) with a TypeScript-level enum only (see the 0019
-- migration) — the new value is added in the Drizzle schema, not in SQL.
--
-- Safe to re-run: guarded with IF NOT EXISTS.

ALTER TABLE "pdr_ai_v2_storage_deletion_items"
    ADD COLUMN IF NOT EXISTS "linked_to_item_id" bigint;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'storage_deletion_items_linked_to_item_id_fk'
    ) THEN
        ALTER TABLE "pdr_ai_v2_storage_deletion_items"
            ADD CONSTRAINT "storage_deletion_items_linked_to_item_id_fk"
            FOREIGN KEY ("linked_to_item_id")
            REFERENCES "pdr_ai_v2_storage_deletion_items"("id")
            ON DELETE SET NULL;
    END IF;
END
$$;

-- Needed by the purge-time materialization step, which asks "does any item
-- anywhere point at one of the leader items I am about to cascade away?"
CREATE INDEX IF NOT EXISTS "storage_deletion_items_linked_to_item_id_idx"
    ON "pdr_ai_v2_storage_deletion_items" ("linked_to_item_id");
