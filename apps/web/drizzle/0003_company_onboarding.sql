-- Add onboarding profile columns to company table
ALTER TABLE "company"
    ADD COLUMN IF NOT EXISTS "description" text,
    ADD COLUMN IF NOT EXISTS "industry" varchar(256);
