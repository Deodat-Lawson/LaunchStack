-- Migration: Add company_api_keys table for per-company API key storage
-- This enables multi-provider embedding support where each company can
-- configure their own embedding provider (OpenAI, Google, Cohere, Voyage)
-- with encrypted API keys.

CREATE TABLE IF NOT EXISTS "pdr_ai_v2_company_api_keys" (
    "id" serial PRIMARY KEY NOT NULL,
    "company_id" bigint NOT NULL,
    "provider" varchar(64) NOT NULL,
    "encrypted_api_key" text NOT NULL,
    "key_iv" varchar(64) NOT NULL,
    "key_tag" varchar(64) NOT NULL,
    "label" varchar(128),
    "last_used_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updated_at" timestamp with time zone
);

-- One key per provider per company
CREATE UNIQUE INDEX IF NOT EXISTS "company_api_keys_company_provider_uniq"
    ON "pdr_ai_v2_company_api_keys" ("company_id", "provider");

-- Foreign key to company table
ALTER TABLE "pdr_ai_v2_company_api_keys"
    ADD CONSTRAINT "pdr_ai_v2_company_api_keys_company_id_pdr_ai_v2_company_id_fk"
    FOREIGN KEY ("company_id")
    REFERENCES "pdr_ai_v2_company"("id")
    ON DELETE CASCADE
    ON UPDATE NO ACTION;
