-- Email campaign lifecycle: immutable template versions, approvals, frozen
-- recipients, and idempotent send attempts.
--
-- Splits generation (probabilistic, reversible) from sending (an irreversible
-- external side effect). A send resolves one already-approved template version
-- and never calls an LLM, so a client retry after a timeout can no longer
-- produce different content or a second delivery.

-- ── campaigns: lifecycle columns ────────────────────────────────────────────
ALTER TABLE "pdr_ai_v2_email_campaigns"
    ADD COLUMN IF NOT EXISTS "goal" text,
    ADD COLUMN IF NOT EXISTS "approved_version_id" integer,
    ADD COLUMN IF NOT EXISTS "created_by" integer,
    ADD COLUMN IF NOT EXISTS "updated_at" timestamp DEFAULT now() NOT NULL;

-- ── immutable template versions ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "pdr_ai_v2_email_template_versions" (
    "id" serial PRIMARY KEY NOT NULL,
    "campaign_id" integer NOT NULL REFERENCES "pdr_ai_v2_email_campaigns" ("id") ON DELETE CASCADE,
    "version" integer NOT NULL,
    "subject" text NOT NULL,
    "body" text NOT NULL,
    "variables" jsonb,
    "source" varchar(20) DEFAULT 'ai_generated' NOT NULL,
    "goal" text,
    "model" varchar(64),
    "prompt_version" varchar(32),
    "review_verdict" varchar(16),
    "review" jsonb,
    "created_by" integer,
    "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "email_template_versions_campaign_idx"
    ON "pdr_ai_v2_email_template_versions" ("campaign_id");
CREATE UNIQUE INDEX IF NOT EXISTS "email_template_versions_campaign_version_uq"
    ON "pdr_ai_v2_email_template_versions" ("campaign_id", "version");

-- The approved-version pointer can only be added once the versions table exists.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'email_campaigns_approved_version_fk'
    ) THEN
        ALTER TABLE "pdr_ai_v2_email_campaigns"
            ADD CONSTRAINT "email_campaigns_approved_version_fk"
            FOREIGN KEY ("approved_version_id")
            REFERENCES "pdr_ai_v2_email_template_versions" ("id") ON DELETE SET NULL;
    END IF;
END $$;

-- ── approvals (append-only audit) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "pdr_ai_v2_email_campaign_approvals" (
    "id" serial PRIMARY KEY NOT NULL,
    "campaign_id" integer NOT NULL REFERENCES "pdr_ai_v2_email_campaigns" ("id") ON DELETE CASCADE,
    "template_version_id" integer NOT NULL REFERENCES "pdr_ai_v2_email_template_versions" ("id") ON DELETE CASCADE,
    "approved_by" integer,
    "approved_by_email" varchar(320),
    "approved_by_kind" varchar(16) DEFAULT 'human' NOT NULL,
    "review_verdict" varchar(16),
    "override_reason" text,
    "revoked_at" timestamp,
    "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "email_campaign_approvals_campaign_idx"
    ON "pdr_ai_v2_email_campaign_approvals" ("campaign_id");
CREATE INDEX IF NOT EXISTS "email_campaign_approvals_version_idx"
    ON "pdr_ai_v2_email_campaign_approvals" ("template_version_id");

-- ── send attempts (idempotency boundary) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS "pdr_ai_v2_email_send_attempts" (
    "id" serial PRIMARY KEY NOT NULL,
    "campaign_id" integer NOT NULL REFERENCES "pdr_ai_v2_email_campaigns" ("id") ON DELETE CASCADE,
    "template_version_id" integer NOT NULL REFERENCES "pdr_ai_v2_email_template_versions" ("id") ON DELETE CASCADE,
    "idempotency_key" varchar(200) NOT NULL,
    "mode" varchar(16) DEFAULT 'dry_run' NOT NULL,
    "status" varchar(16) DEFAULT 'running' NOT NULL,
    "requested_by" integer,
    "recipient_count" integer DEFAULT 0 NOT NULL,
    "sent_count" integer DEFAULT 0 NOT NULL,
    "failed_count" integer DEFAULT 0 NOT NULL,
    "suppressed_count" integer DEFAULT 0 NOT NULL,
    "skipped_count" integer DEFAULT 0 NOT NULL,
    "error" text,
    "started_at" timestamp DEFAULT now() NOT NULL,
    "completed_at" timestamp
);

CREATE INDEX IF NOT EXISTS "email_send_attempts_campaign_idx"
    ON "pdr_ai_v2_email_send_attempts" ("campaign_id");
-- The retry guard: one attempt per (campaign, idempotency key).
CREATE UNIQUE INDEX IF NOT EXISTS "email_send_attempts_campaign_key_uq"
    ON "pdr_ai_v2_email_send_attempts" ("campaign_id", "idempotency_key");

-- ── recipients: merge vars + list freezing ──────────────────────────────────
ALTER TABLE "pdr_ai_v2_email_recipients"
    ADD COLUMN IF NOT EXISTS "vars" jsonb,
    ADD COLUMN IF NOT EXISTS "frozen_at" timestamp;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'email_recipients_campaign_fk'
    ) THEN
        ALTER TABLE "pdr_ai_v2_email_recipients"
            ADD CONSTRAINT "email_recipients_campaign_fk"
            FOREIGN KEY ("campaign_id")
            REFERENCES "pdr_ai_v2_email_campaigns" ("id") ON DELETE CASCADE;
    END IF;
END $$;

-- Dedup before the unique index; no writer existed for this table before the
-- lifecycle work, so in practice this is a no-op guard.
DELETE FROM "pdr_ai_v2_email_recipients" a
    USING "pdr_ai_v2_email_recipients" b
    WHERE a."id" > b."id"
      AND a."campaign_id" = b."campaign_id"
      AND a."email" = b."email";

CREATE UNIQUE INDEX IF NOT EXISTS "email_recipients_campaign_email_uq"
    ON "pdr_ai_v2_email_recipients" ("campaign_id", "email");

-- ── sends: tie each row to its attempt ──────────────────────────────────────
ALTER TABLE "pdr_ai_v2_email_sends"
    ADD COLUMN IF NOT EXISTS "attempt_id" integer,
    ADD COLUMN IF NOT EXISTS "recipient_id" integer;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'email_sends_attempt_fk'
    ) THEN
        ALTER TABLE "pdr_ai_v2_email_sends"
            ADD CONSTRAINT "email_sends_attempt_fk"
            FOREIGN KEY ("attempt_id")
            REFERENCES "pdr_ai_v2_email_send_attempts" ("id") ON DELETE CASCADE;
    END IF;
END $$;

-- NULLs are distinct in Postgres, so pre-lifecycle rows (attempt_id IS NULL)
-- are unaffected while every new attempt gets one row per recipient.
CREATE UNIQUE INDEX IF NOT EXISTS "email_sends_attempt_recipient_uq"
    ON "pdr_ai_v2_email_sends" ("attempt_id", "recipient_email");

CREATE INDEX IF NOT EXISTS "email_campaigns_company_status_idx"
    ON "pdr_ai_v2_email_campaigns" ("company_id", "status");
