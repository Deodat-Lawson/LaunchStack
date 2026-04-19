-- Add Onyx-style SearchSettings lifecycle columns to the company row so we
-- can queue a background re-embedding job when a company switches its
-- embedding model instead of silently orphaning its old embeddings.
--
-- Semantics (see src/lib/ai/company-reindex-state.ts for the state machine):
--   active_embedding_index_key   -- currently serving queries/ingest
--   pending_embedding_index_key  -- target of an in-progress reindex, or NULL
--   reindex_status               -- 'STABLE' | 'REINDEXING' | 'FAILED'
--   reindex_job_id               -- Inngest event ID of the running reindex
--   reindex_started_at           -- when the current reindex began
--   reindex_completed_at         -- when the last successful reindex ended
--   reindex_error                -- failure message, cleared on STABLE
--
-- The legacy `embedding_index_key` column stays for a couple of releases
-- and is kept in sync with `active_embedding_index_key` by the resolver.
-- It can be dropped in a follow-up migration once callers are migrated.

ALTER TABLE "pdr_ai_v2_company"
    ADD COLUMN IF NOT EXISTS "active_embedding_index_key" varchar(128),
    ADD COLUMN IF NOT EXISTS "pending_embedding_index_key" varchar(128),
    ADD COLUMN IF NOT EXISTS "reindex_status" varchar(16) NOT NULL DEFAULT 'STABLE',
    ADD COLUMN IF NOT EXISTS "reindex_job_id" text,
    ADD COLUMN IF NOT EXISTS "reindex_started_at" timestamptz,
    ADD COLUMN IF NOT EXISTS "reindex_completed_at" timestamptz,
    ADD COLUMN IF NOT EXISTS "reindex_error" text;

-- One-shot backfill: any existing company row's current index key becomes
-- the active one. Safe to re-run — null source leaves null target.
UPDATE "pdr_ai_v2_company"
SET "active_embedding_index_key" = "embedding_index_key"
WHERE "active_embedding_index_key" IS NULL
  AND "embedding_index_key" IS NOT NULL;
