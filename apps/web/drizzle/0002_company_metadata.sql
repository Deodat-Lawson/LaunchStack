-- Company Metadata Tables
-- One canonical JSON row per company + append-only audit history.

CREATE TABLE IF NOT EXISTS "company_metadata" (
    "id"                          serial PRIMARY KEY NOT NULL,
    "company_id"                  bigint NOT NULL REFERENCES "company"("id") ON DELETE CASCADE,
    "schema_version"              varchar(20) NOT NULL DEFAULT '1.0.0',
    "metadata"                    jsonb NOT NULL,
    "last_extraction_document_id" bigint REFERENCES "document"("id") ON DELETE SET NULL,
    "created_at"                  timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"                  timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS "company_metadata_company_id_unique"
    ON "company_metadata" ("company_id");

-- ============================================================================

CREATE TABLE IF NOT EXISTS "company_metadata_history" (
    "id"          serial PRIMARY KEY NOT NULL,
    "company_id"  bigint NOT NULL REFERENCES "company"("id") ON DELETE CASCADE,
    "document_id" bigint REFERENCES "document"("id") ON DELETE SET NULL,
    "change_type" varchar(32) NOT NULL,   -- extraction | merge | manual_override | deprecation
    "diff"        jsonb NOT NULL,
    "changed_by"  varchar(256) NOT NULL,
    "created_at"  timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "company_metadata_history_company_id_idx"
    ON "company_metadata_history" ("company_id");

CREATE INDEX IF NOT EXISTS "company_metadata_history_document_id_idx"
    ON "company_metadata_history" ("document_id");

CREATE INDEX IF NOT EXISTS "company_metadata_history_created_at_idx"
    ON "company_metadata_history" ("created_at");

CREATE INDEX IF NOT EXISTS "company_metadata_history_change_type_idx"
    ON "company_metadata_history" ("change_type");
