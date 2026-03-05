CREATE TABLE IF NOT EXISTS "upload_batches" (
    "id" varchar(64) PRIMARY KEY NOT NULL,
    "company_id" bigint NOT NULL REFERENCES "company"("id") ON DELETE CASCADE,
    "created_by_user_id" varchar(256) NOT NULL,
    "status" varchar(32) NOT NULL DEFAULT 'created',
    "metadata" jsonb,
    "total_files" integer NOT NULL DEFAULT 0,
    "uploaded_files" integer NOT NULL DEFAULT 0,
    "processed_files" integer NOT NULL DEFAULT 0,
    "failed_files" integer NOT NULL DEFAULT 0,
    "committed_at" timestamptz,
    "processing_started_at" timestamptz,
    "completed_at" timestamptz,
    "failed_at" timestamptz,
    "error_message" text,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "upload_batch_files" (
    "id" serial PRIMARY KEY NOT NULL,
    "batch_id" varchar(64) NOT NULL REFERENCES "upload_batches"("id") ON DELETE CASCADE,
    "company_id" bigint NOT NULL REFERENCES "company"("id") ON DELETE CASCADE,
    "user_id" varchar(256) NOT NULL,
    "filename" varchar(512) NOT NULL,
    "relative_path" varchar(1024),
    "mime_type" varchar(128),
    "file_size_bytes" bigint,
    "storage_url" varchar(1024),
    "storage_type" varchar(32),
    "status" varchar(32) NOT NULL DEFAULT 'queued',
    "metadata" jsonb,
    "document_id" bigint REFERENCES "document"("id") ON DELETE SET NULL,
    "job_id" varchar(256) REFERENCES "ocr_jobs"("id") ON DELETE SET NULL,
    "error_message" text,
    "uploaded_at" timestamptz,
    "processed_at" timestamptz,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "upload_batches_company_idx" ON "upload_batches" ("company_id");
CREATE INDEX IF NOT EXISTS "upload_batches_creator_idx" ON "upload_batches" ("created_by_user_id");
CREATE INDEX IF NOT EXISTS "upload_batches_status_idx" ON "upload_batches" ("status");

CREATE INDEX IF NOT EXISTS "upload_batch_files_batch_idx" ON "upload_batch_files" ("batch_id");
CREATE INDEX IF NOT EXISTS "upload_batch_files_status_idx" ON "upload_batch_files" ("status");
CREATE INDEX IF NOT EXISTS "upload_batch_files_job_idx" ON "upload_batch_files" ("job_id");
CREATE INDEX IF NOT EXISTS "upload_batch_files_document_idx" ON "upload_batch_files" ("document_id");
