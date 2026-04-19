-- Per-company embedding provider credentials with encryption at rest.
--
-- The `company.embedding_openai_api_key` and
-- `company.embedding_huggingface_api_key` columns from migration 0008 are
-- plaintext, which is unsafe for production. This migration introduces a
-- new table where those keys live as AES-256-GCM ciphertext plus a 4-char
-- suffix for UI feedback. Non-secret config (Ollama base URL / model)
-- continues to be plaintext for operator convenience.
--
-- Rollout plan:
--   1. Apply this migration (the new table is created empty).
--   2. Deploy application code that reads/writes via the new table.
--   3. Run `pnpm tsx scripts/backfill-embedding-credentials.ts` to encrypt
--      existing plaintext values from `company` into this table and null
--      out the old columns.
--   4. Once verified, apply 0011_drop_plaintext_embedding_credentials.sql
--      to remove the legacy columns.

CREATE TABLE IF NOT EXISTS "pdr_ai_v2_company_embedding_credentials" (
    "company_id" integer PRIMARY KEY REFERENCES "pdr_ai_v2_company"("id") ON DELETE CASCADE,
    "openai_api_key_ciphertext" text,
    "openai_api_key_last4" varchar(8),
    "huggingface_api_key_ciphertext" text,
    "huggingface_api_key_last4" varchar(8),
    "ollama_base_url" text,
    "ollama_model" varchar(256),
    "encryption_key_version" smallint NOT NULL DEFAULT 1,
    "updated_at" timestamptz NOT NULL DEFAULT now()
);
