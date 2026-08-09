-- Email outreach pipeline: a staged campaign lifecycle.
--
-- Generation and delivery are separate transitions. A send resolves one
-- already-approved, immutable template version and never calls an LLM, so a
-- client retry after a timeout cannot produce different content or a second
-- delivery.
--
-- Created in final form deliberately: these tables have never reached main, so
-- there is nothing to migrate forward and no reason to ship a create-then-
-- repair pair.

CREATE TABLE IF NOT EXISTS "pdr_ai_v2_email_campaigns" (
    "id" serial PRIMARY KEY NOT NULL,
    "company_id" bigint NOT NULL,
    "name" varchar(256) NOT NULL,
    "goal" text,
    "status" varchar(20) DEFAULT 'draft' NOT NULL,
    -- Cleared for delivery. NULL until approved, and cleared again whenever a
    -- new version is appended, so an edit cannot ship under an old approval.
    "approved_version_id" integer,
    -- Claimed BEFORE generation by an unattended run; unique per company, so a
    -- retried run resumes this campaign instead of generating a second one.
    "automation_key" varchar(200),
    "created_by" integer,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);

-- Append-only. An approval points at a row here, so mutating one would
-- retroactively change what was approved and what was sent.
CREATE TABLE IF NOT EXISTS "pdr_ai_v2_email_template_versions" (
    "id" serial PRIMARY KEY NOT NULL,
    "campaign_id" integer NOT NULL
        REFERENCES "pdr_ai_v2_email_campaigns" ("id") ON DELETE CASCADE,
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

ALTER TABLE "pdr_ai_v2_email_campaigns"
    ADD CONSTRAINT "email_campaigns_approved_version_fk"
    FOREIGN KEY ("approved_version_id")
    REFERENCES "pdr_ai_v2_email_template_versions" ("id") ON DELETE SET NULL;

-- Append-only audit: approving a different version revokes the previous row
-- rather than overwriting it.
CREATE TABLE IF NOT EXISTS "pdr_ai_v2_email_campaign_approvals" (
    "id" serial PRIMARY KEY NOT NULL,
    "campaign_id" integer NOT NULL
        REFERENCES "pdr_ai_v2_email_campaigns" ("id") ON DELETE CASCADE,
    "template_version_id" integer NOT NULL
        REFERENCES "pdr_ai_v2_email_template_versions" ("id") ON DELETE CASCADE,
    "approved_by" integer,
    "approved_by_email" varchar(320),
    "approved_by_kind" varchar(16) DEFAULT 'human' NOT NULL,
    "review_verdict" varchar(16),
    "override_reason" text,
    "revoked_at" timestamp,
    "created_at" timestamp DEFAULT now() NOT NULL
);

-- The audience, frozen at first dispatch.
CREATE TABLE IF NOT EXISTS "pdr_ai_v2_email_recipients" (
    "id" serial PRIMARY KEY NOT NULL,
    "campaign_id" integer NOT NULL
        REFERENCES "pdr_ai_v2_email_campaigns" ("id") ON DELETE CASCADE,
    "email" varchar(320) NOT NULL,
    "name" varchar(256),
    "company" varchar(256),
    "context_notes" text,
    "vars" jsonb,
    "status" varchar(20) DEFAULT 'pending' NOT NULL,
    "frozen_at" timestamp,
    "created_at" timestamp DEFAULT now() NOT NULL
);

-- One row per /send call. The unit of idempotency.
CREATE TABLE IF NOT EXISTS "pdr_ai_v2_email_send_attempts" (
    "id" serial PRIMARY KEY NOT NULL,
    "campaign_id" integer NOT NULL
        REFERENCES "pdr_ai_v2_email_campaigns" ("id") ON DELETE CASCADE,
    "template_version_id" integer NOT NULL
        REFERENCES "pdr_ai_v2_email_template_versions" ("id") ON DELETE CASCADE,
    "idempotency_key" varchar(200) NOT NULL,
    "mode" varchar(16) DEFAULT 'dry_run' NOT NULL,
    "status" varchar(16) DEFAULT 'running' NOT NULL,
    "requested_by" integer,
    -- A running attempt whose heartbeat goes stale died mid-delivery; recovery
    -- reclaims it so one crash cannot wedge the campaign forever.
    "heartbeat_at" timestamp DEFAULT now() NOT NULL,
    "recipient_count" integer DEFAULT 0 NOT NULL,
    "sent_count" integer DEFAULT 0 NOT NULL,
    "failed_count" integer DEFAULT 0 NOT NULL,
    "suppressed_count" integer DEFAULT 0 NOT NULL,
    "skipped_count" integer DEFAULT 0 NOT NULL,
    "error" text,
    "started_at" timestamp DEFAULT now() NOT NULL,
    "completed_at" timestamp
);

-- Both the delivery audit trail and the delivery CLAIM: a row is inserted as
-- 'queued' BEFORE the provider is called and updated with the outcome after,
-- so a process that dies between the two leaves evidence that the address may
-- already have been emailed.
CREATE TABLE IF NOT EXISTS "pdr_ai_v2_email_sends" (
    "id" serial PRIMARY KEY NOT NULL,
    "campaign_id" integer NOT NULL
        REFERENCES "pdr_ai_v2_email_campaigns" ("id") ON DELETE CASCADE,
    "attempt_id" integer NOT NULL
        REFERENCES "pdr_ai_v2_email_send_attempts" ("id") ON DELETE CASCADE,
    "recipient_id" integer
        REFERENCES "pdr_ai_v2_email_recipients" ("id") ON DELETE SET NULL,
    "recipient_email" varchar(320) NOT NULL,
    "subject" text,
    "status" varchar(20) DEFAULT 'queued' NOT NULL,
    "provider_message_id" varchar(256),
    "provider_idempotency_key" varchar(256),
    "error" text,
    "sent_at" timestamp,
    "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "pdr_ai_v2_email_suppressions" (
    "id" serial PRIMARY KEY NOT NULL,
    "company_id" bigint NOT NULL,
    "email" varchar(320) NOT NULL,
    "reason" varchar(20) DEFAULT 'unsubscribe' NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "email_campaigns_company_idx"
    ON "pdr_ai_v2_email_campaigns" ("company_id");
CREATE INDEX IF NOT EXISTS "email_campaigns_company_status_idx"
    ON "pdr_ai_v2_email_campaigns" ("company_id", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "email_campaigns_company_automation_key_uq"
    ON "pdr_ai_v2_email_campaigns" ("company_id", "automation_key");

CREATE INDEX IF NOT EXISTS "email_template_versions_campaign_idx"
    ON "pdr_ai_v2_email_template_versions" ("campaign_id");
CREATE UNIQUE INDEX IF NOT EXISTS "email_template_versions_campaign_version_uq"
    ON "pdr_ai_v2_email_template_versions" ("campaign_id", "version");

CREATE INDEX IF NOT EXISTS "email_campaign_approvals_campaign_idx"
    ON "pdr_ai_v2_email_campaign_approvals" ("campaign_id");
CREATE INDEX IF NOT EXISTS "email_campaign_approvals_version_idx"
    ON "pdr_ai_v2_email_campaign_approvals" ("template_version_id");

CREATE INDEX IF NOT EXISTS "email_recipients_campaign_idx"
    ON "pdr_ai_v2_email_recipients" ("campaign_id");
CREATE UNIQUE INDEX IF NOT EXISTS "email_recipients_campaign_email_uq"
    ON "pdr_ai_v2_email_recipients" ("campaign_id", "email");

CREATE INDEX IF NOT EXISTS "email_send_attempts_campaign_idx"
    ON "pdr_ai_v2_email_send_attempts" ("campaign_id");
-- The retry guard: one attempt per (campaign, idempotency key).
CREATE UNIQUE INDEX IF NOT EXISTS "email_send_attempts_campaign_key_uq"
    ON "pdr_ai_v2_email_send_attempts" ("campaign_id", "idempotency_key");

CREATE INDEX IF NOT EXISTS "email_sends_campaign_idx"
    ON "pdr_ai_v2_email_sends" ("campaign_id");
CREATE UNIQUE INDEX IF NOT EXISTS "email_sends_attempt_recipient_uq"
    ON "pdr_ai_v2_email_sends" ("attempt_id", "recipient_email");

CREATE UNIQUE INDEX IF NOT EXISTS "email_suppressions_company_email_uq"
    ON "pdr_ai_v2_email_suppressions" ("company_id", "email");
