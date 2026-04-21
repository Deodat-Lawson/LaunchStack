ALTER TABLE "file_uploads"
    ADD COLUMN IF NOT EXISTS "storage_provider" varchar(64) NOT NULL DEFAULT 'database',
    ADD COLUMN IF NOT EXISTS "storage_url" varchar(1024),
    ADD COLUMN IF NOT EXISTS "storage_pathname" varchar(1024),
    ADD COLUMN IF NOT EXISTS "blob_checksum" varchar(128);

ALTER TABLE "file_uploads"
    ALTER COLUMN "file_data" DROP NOT NULL;
