-- Drop the legacy plaintext embedding credential columns from `company`.
--
-- **Do not apply this migration until** the backfill script has run
-- successfully against this environment:
--
--     pnpm --filter @launchstack/web db:backfill:embedding-credentials
--
-- The backfill copies every non-null plaintext key into
-- `pdr_ai_v2_company_embedding_credentials` (encrypted) and then NULLs out
-- the legacy columns. Applying this migration before the backfill will
-- permanently destroy un-migrated company API keys.
--
-- The application reads credentials only from the encrypted table; these
-- legacy columns must not remain in the Drizzle company schema.

ALTER TABLE "pdr_ai_v2_company"
    DROP COLUMN IF EXISTS "embedding_openai_api_key",
    DROP COLUMN IF EXISTS "embedding_huggingface_api_key",
    DROP COLUMN IF EXISTS "embedding_ollama_base_url",
    DROP COLUMN IF EXISTS "embedding_ollama_model";
