-- Tenant stamp on file_uploads.
--
-- 1. Adds a nullable `company_id` to `pdr_ai_v2_file_uploads`. New uploads
--    stamp the active workspace so `/api/files/{id}` can enforce ownership
--    from the row itself instead of inferring it from the uploader.
--
-- 2. Backfills legacy rows from the `document` row that the same upload
--    request created, matched on the `/api/files/{id}` URL. That document
--    carries the company the file was uploaded into, so it is an
--    upload-time-authoritative source. Uploader membership is deliberately
--    NOT used: today's memberships say nothing about who owned the file when
--    it was written. Rows that stay null are denied by the route.
--
-- Safe to re-run: every statement is idempotent.

ALTER TABLE "pdr_ai_v2_file_uploads"
    ADD COLUMN IF NOT EXISTS "company_id" bigint
    REFERENCES "pdr_ai_v2_company"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "file_uploads_company_id_idx"
    ON "pdr_ai_v2_file_uploads" ("company_id");

-- Backfill only where every document pointing at the file agrees on one
-- company. A file referenced from two tenants is left null (denied) rather
-- than guessed at.
WITH file_owner AS (
    SELECT
        (regexp_match(d."url", '/api/files/([0-9]+)'))[1]::bigint AS file_id,
        MIN(d."company_id") AS company_id,
        COUNT(DISTINCT d."company_id") AS company_count
    FROM "pdr_ai_v2_document" d
    WHERE d."url" ~ '/api/files/[0-9]+'
    GROUP BY 1
)
UPDATE "pdr_ai_v2_file_uploads" f
SET "company_id" = o.company_id
FROM file_owner o
WHERE f."id" = o.file_id
  AND o.company_count = 1
  AND f."company_id" IS NULL;
