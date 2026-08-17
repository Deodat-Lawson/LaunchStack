-- Storage deletion lifecycle — durable deletion intent.
--
-- storage_deletion_requests is the outer record ("delete document #42");
-- storage_deletion_items is one row per physical object that must be
-- deleted to fulfill it. Recorded *before* any storage or relational
-- deletion happens, so a crash mid-delete never loses track of what still
-- needs cleaning up.
--
-- requests.status is a maintained summary (updated by the worker as items
-- change), not recomputed on read — chosen for fast status-polling reads.
--
-- Safe to re-run: table creation is guarded with IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS "pdr_ai_v2_storage_deletion_requests" (
    "id" serial PRIMARY KEY,
    "company_id" bigint NOT NULL REFERENCES "pdr_ai_v2_company"("id") ON DELETE CASCADE,
    -- Exactly one of these two must be set — enforced by the CHECK below.
    "document_id" bigint REFERENCES "pdr_ai_v2_document"("id") ON DELETE CASCADE,
    "document_version_id" bigint REFERENCES "pdr_ai_v2_document_versions"("id") ON DELETE CASCADE,
    "requested_by" varchar(256) NOT NULL,
    "status" varchar(32) NOT NULL DEFAULT 'queued',
    "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" timestamptz,
    "completed_at" timestamptz,

    CONSTRAINT "storage_deletion_requests_exactly_one_target_check" CHECK (
        (CASE WHEN "document_id" IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN "document_version_id" IS NOT NULL THEN 1 ELSE 0 END) = 1
    )
);

CREATE INDEX IF NOT EXISTS "storage_deletion_requests_company_id_idx"
    ON "pdr_ai_v2_storage_deletion_requests" ("company_id");
CREATE INDEX IF NOT EXISTS "storage_deletion_requests_document_id_idx"
    ON "pdr_ai_v2_storage_deletion_requests" ("document_id");
CREATE INDEX IF NOT EXISTS "storage_deletion_requests_document_version_id_idx"
    ON "pdr_ai_v2_storage_deletion_requests" ("document_version_id");
CREATE INDEX IF NOT EXISTS "storage_deletion_requests_status_idx"
    ON "pdr_ai_v2_storage_deletion_requests" ("status");

-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "pdr_ai_v2_storage_deletion_items" (
    "id" serial PRIMARY KEY,
    "request_id" bigint NOT NULL REFERENCES "pdr_ai_v2_storage_deletion_requests"("id") ON DELETE CASCADE,
    -- Nullable: legacy-promoted refs (no manifest row yet) carry the ref
    -- fields directly instead of pointing at a storage_objects row.
    "object_id" bigint REFERENCES "pdr_ai_v2_storage_objects"("id") ON DELETE SET NULL,
    "adapter" varchar(32) NOT NULL,
    "storage_location_id" varchar(256) NOT NULL,
    "key" text NOT NULL,
    "item_state" varchar(32) NOT NULL DEFAULT 'PENDING',
    "attempts" integer NOT NULL DEFAULT 0,
    "last_error" text,
    "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" timestamptz
);

CREATE INDEX IF NOT EXISTS "storage_deletion_items_request_id_idx"
    ON "pdr_ai_v2_storage_deletion_items" ("request_id");
CREATE INDEX IF NOT EXISTS "storage_deletion_items_object_id_idx"
    ON "pdr_ai_v2_storage_deletion_items" ("object_id");
CREATE INDEX IF NOT EXISTS "storage_deletion_items_item_state_idx"
    ON "pdr_ai_v2_storage_deletion_items" ("item_state");
