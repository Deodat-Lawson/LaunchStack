-- Document creation lifecycle keys and version-linked OCR jobs.
-- Safe to re-run: all DDL is additive and idempotent.

ALTER TABLE "pdr_ai_v2_document"
    ADD COLUMN IF NOT EXISTS "creation_key" varchar(512),
    ADD COLUMN IF NOT EXISTS "source_archive_entry" varchar(1024);

ALTER TABLE "pdr_ai_v2_document_versions"
    ADD COLUMN IF NOT EXISTS "creation_key" varchar(512);

ALTER TABLE "pdr_ai_v2_ocr_jobs"
    ADD COLUMN IF NOT EXISTS "version_id" bigint
        REFERENCES "pdr_ai_v2_document_versions"("id") ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS "dispatch_options" jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS "document_company_creation_key_unique"
    ON "pdr_ai_v2_document" ("company_id", "creation_key");

CREATE UNIQUE INDEX IF NOT EXISTS "doc_versions_document_creation_key_unique"
    ON "pdr_ai_v2_document_versions" ("document_id", "creation_key");

CREATE INDEX IF NOT EXISTS "ocr_jobs_document_id_idx"
    ON "pdr_ai_v2_ocr_jobs" ("document_id");

CREATE INDEX IF NOT EXISTS "ocr_jobs_version_id_idx"
    ON "pdr_ai_v2_ocr_jobs" ("version_id");
