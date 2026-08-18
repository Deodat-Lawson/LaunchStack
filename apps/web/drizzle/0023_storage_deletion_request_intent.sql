-- Add intent column to distinguish full document/version purge from object-only cleanup.
--
-- Safe to re-run: guarded with IF NOT EXISTS.

ALTER TABLE "pdr_ai_v2_storage_deletion_requests"
ADD COLUMN IF NOT EXISTS "intent" varchar(32) NOT NULL DEFAULT 'document_purge';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'storage_deletion_requests_intent_check'
    ) THEN
        ALTER TABLE "pdr_ai_v2_storage_deletion_requests"
            ADD CONSTRAINT "storage_deletion_requests_intent_check"
            CHECK ("intent" IN ('document_purge', 'version_purge', 'object_cleanup'));
    END IF;
END
$$;
