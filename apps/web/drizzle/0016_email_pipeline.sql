-- Email outreach pipeline: campaigns, recipients, per-recipient sends, suppressions.

CREATE TABLE IF NOT EXISTS "pdr_ai_v2_email_campaigns" (
    "id" serial PRIMARY KEY NOT NULL,
    "company_id" bigint NOT NULL,
    "name" varchar(256) NOT NULL,
    "status" varchar(20) DEFAULT 'draft' NOT NULL,
    "subject" text,
    "body" text,
    "model" varchar(64),
    "prompt_version" varchar(32),
    "template_version" varchar(32),
    "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "pdr_ai_v2_email_recipients" (
    "id" serial PRIMARY KEY NOT NULL,
    "campaign_id" integer NOT NULL,
    "email" varchar(320) NOT NULL,
    "name" varchar(256),
    "company" varchar(256),
    "context_notes" text,
    "status" varchar(20) DEFAULT 'pending' NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "pdr_ai_v2_email_sends" (
    "id" serial PRIMARY KEY NOT NULL,
    "campaign_id" integer NOT NULL,
    "recipient_email" varchar(320) NOT NULL,
    "subject" text,
    "status" varchar(20) NOT NULL,
    "provider_message_id" varchar(256),
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

CREATE INDEX IF NOT EXISTS "email_campaigns_company_idx" ON "pdr_ai_v2_email_campaigns" ("company_id");
CREATE INDEX IF NOT EXISTS "email_recipients_campaign_idx" ON "pdr_ai_v2_email_recipients" ("campaign_id");
CREATE INDEX IF NOT EXISTS "email_sends_campaign_idx" ON "pdr_ai_v2_email_sends" ("campaign_id");
CREATE UNIQUE INDEX IF NOT EXISTS "email_suppressions_company_email_uq" ON "pdr_ai_v2_email_suppressions" ("company_id","email");
