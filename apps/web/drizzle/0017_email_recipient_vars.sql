-- Persist Recipient.vars — the extra per-recipient merge variables (e.g. any
-- columns a user had in their CSV beyond name/company). The TypeScript contract
-- has always carried them; without this column they were lost on write.

ALTER TABLE "pdr_ai_v2_email_recipients"
    ADD COLUMN IF NOT EXISTS "vars" jsonb;
