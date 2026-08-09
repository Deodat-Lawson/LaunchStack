ALTER TABLE "pdr_ai_v2_file_uploads" ADD COLUMN "company_id" bigint;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_file_uploads" ADD CONSTRAINT "pdr_ai_v2_file_uploads_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "file_uploads_company_id_idx" ON "pdr_ai_v2_file_uploads" USING btree ("company_id");--> statement-breakpoint

-- Backfill only where every document pointing at the file agrees on one
-- company. A file referenced from two tenants is left null (denied) rather
-- than guessed at. Uploader membership is deliberately NOT used: today's
-- memberships say nothing about who owned the file when it was written.
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
