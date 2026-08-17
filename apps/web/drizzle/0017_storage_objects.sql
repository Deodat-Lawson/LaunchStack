-- Storage deletion lifecycle — manifest table.
--
-- Tracks provider-owned object identity (adapter/storageLocationId/key)
-- independent of URLs, so a document's deletion can enumerate and clean up
-- every file it actually owns. One row per real object in storage.
--
-- Ownership is polymorphic across document / document_versions / artifact,
-- enforced via three nullable FK columns + a CHECK requiring exactly one to
-- be set (see team discussion — nullable-FK approach chosen over an
-- unconstrained ownerType/ownerId pair for real referential integrity).
--
-- Safe to re-run: table creation is guarded with IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS "pdr_ai_v2_storage_objects" (
    "id" serial PRIMARY KEY,

    -- Immutable ObjectRef — opaque outside the adapter that minted it.
    "adapter" varchar(32) NOT NULL,
    "storage_location_id" varchar(256) NOT NULL,
    "key" text NOT NULL,

    -- Tenant + owner. Exactly one of document_id / document_version_id /
    -- artifact_id must be set — enforced by the CHECK constraint below.
    "company_id" bigint NOT NULL REFERENCES "pdr_ai_v2_company"("id") ON DELETE CASCADE,
    "document_id" bigint REFERENCES "pdr_ai_v2_document"("id") ON DELETE CASCADE,
    "document_version_id" bigint REFERENCES "pdr_ai_v2_document_versions"("id") ON DELETE CASCADE,
    "artifact_id" bigint,

    -- Metadata — best-effort, not all providers supply all fields.
    "content_type" varchar(128),
    "size_bytes" bigint,
    "checksum" varchar(256),
    "source_operation" varchar(64),

    -- Lifecycle
    "lifecycle_state" varchar(32) NOT NULL DEFAULT 'ACTIVE',
    "deletion_attempts" integer NOT NULL DEFAULT 0,
    "last_error" text,

    "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" timestamptz,

    CONSTRAINT "storage_objects_exactly_one_owner_check" CHECK (
        (CASE WHEN "document_id" IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN "document_version_id" IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN "artifact_id" IS NOT NULL THEN 1 ELSE 0 END) = 1
    )
);

-- Never two manifest rows claiming the same physical object.
CREATE UNIQUE INDEX IF NOT EXISTS "storage_objects_adapter_location_key_unique"
    ON "pdr_ai_v2_storage_objects" ("adapter", "storage_location_id", "key");

CREATE INDEX IF NOT EXISTS "storage_objects_company_id_idx"
    ON "pdr_ai_v2_storage_objects" ("company_id");
CREATE INDEX IF NOT EXISTS "storage_objects_document_id_idx"
    ON "pdr_ai_v2_storage_objects" ("document_id");
CREATE INDEX IF NOT EXISTS "storage_objects_document_version_id_idx"
    ON "pdr_ai_v2_storage_objects" ("document_version_id");
CREATE INDEX IF NOT EXISTS "storage_objects_lifecycle_state_idx"
    ON "pdr_ai_v2_storage_objects" ("lifecycle_state");
