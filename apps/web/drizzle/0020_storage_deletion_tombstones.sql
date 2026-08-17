-- Storage deletion lifecycle — permanent, post-purge audit + idempotency.
--
-- A tombstone is the one thing that survives after a document/version is
-- hard-deleted in RELATIONAL_PURGE — it's what lets a duplicate/repeat
-- delete request on an already-purged document return the existing outcome
-- instead of erroring or redoing work. Kept intentionally minimal: detailed
-- per-object outcomes already live in storage_deletion_items.
--
-- document_id / document_version_id are plain, unconstrained bigints — NOT
-- real foreign keys. A real FK would either block the document from ever
-- being purged, or cascade-delete the tombstone along with it, defeating
-- the whole point of a tombstone surviving the purge it's recording.
--
-- Safe to re-run: table creation is guarded with IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS "pdr_ai_v2_storage_deletion_tombstones" (
    "id" serial PRIMARY KEY,
    "request_id" bigint REFERENCES "pdr_ai_v2_storage_deletion_requests"("id") ON DELETE SET NULL,
    "company_id" bigint NOT NULL REFERENCES "pdr_ai_v2_company"("id") ON DELETE CASCADE,
    -- Intentionally not a real FK — see comment above.
    "document_id" bigint,
    "document_version_id" bigint,
    -- Only the two real terminal outcomes a tombstone can represent.
    "final_status" varchar(32) NOT NULL,
    "object_count" integer NOT NULL DEFAULT 0,
    "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- One tombstone per document / per version — supports the idempotency
-- lookup ("has this already been handled").
CREATE UNIQUE INDEX IF NOT EXISTS "storage_deletion_tombstones_document_id_unique"
    ON "pdr_ai_v2_storage_deletion_tombstones" ("document_id");
CREATE UNIQUE INDEX IF NOT EXISTS "storage_deletion_tombstones_document_version_id_unique"
    ON "pdr_ai_v2_storage_deletion_tombstones" ("document_version_id");

CREATE INDEX IF NOT EXISTS "storage_deletion_tombstones_request_id_idx"
    ON "pdr_ai_v2_storage_deletion_tombstones" ("request_id");
CREATE INDEX IF NOT EXISTS "storage_deletion_tombstones_company_id_idx"
    ON "pdr_ai_v2_storage_deletion_tombstones" ("company_id");
