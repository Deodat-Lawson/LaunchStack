-- Add workspace type column to company table (supports solo/personal workspaces)
ALTER TABLE "company"
    ADD COLUMN IF NOT EXISTS "type" varchar(20) NOT NULL DEFAULT 'company';

-- Add per-company embedding configuration
ALTER TABLE "company"
    ADD COLUMN IF NOT EXISTS "embedding_config" jsonb;
