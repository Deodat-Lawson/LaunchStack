CREATE TABLE "pdr_ai_v2_email_campaign_approvals" (
	"id" serial PRIMARY KEY NOT NULL,
	"campaign_id" integer NOT NULL,
	"template_version_id" integer NOT NULL,
	"approved_by" integer,
	"approved_by_email" varchar(320),
	"approved_by_kind" varchar(16) DEFAULT 'human' NOT NULL,
	"review_verdict" varchar(16),
	"override_reason" text,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_email_campaigns" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"name" varchar(256) NOT NULL,
	"goal" text,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"approved_version_id" integer,
	"automation_key" varchar(200),
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_email_recipients" (
	"id" serial PRIMARY KEY NOT NULL,
	"campaign_id" integer NOT NULL,
	"email" varchar(320) NOT NULL,
	"name" varchar(256),
	"company" varchar(256),
	"context_notes" text,
	"vars" jsonb,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"frozen_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_email_send_attempts" (
	"id" serial PRIMARY KEY NOT NULL,
	"campaign_id" integer NOT NULL,
	"template_version_id" integer NOT NULL,
	"idempotency_key" varchar(200) NOT NULL,
	"mode" varchar(16) DEFAULT 'dry_run' NOT NULL,
	"status" varchar(16) DEFAULT 'running' NOT NULL,
	"requested_by" integer,
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
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_email_sends" (
	"id" serial PRIMARY KEY NOT NULL,
	"campaign_id" integer NOT NULL,
	"attempt_id" integer NOT NULL,
	"recipient_id" integer,
	"recipient_email" varchar(320) NOT NULL,
	"subject" text,
	"status" varchar(20) DEFAULT 'queued' NOT NULL,
	"provider_message_id" varchar(256),
	"provider_idempotency_key" varchar(256),
	"error" text,
	"sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_email_suppressions" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"email" varchar(320) NOT NULL,
	"reason" varchar(20) DEFAULT 'unsubscribe' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_email_template_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"campaign_id" integer NOT NULL,
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
--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_email_campaign_approvals" ADD CONSTRAINT "pdr_ai_v2_email_campaign_approvals_campaign_id_pdr_ai_v2_email_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."pdr_ai_v2_email_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_email_campaign_approvals" ADD CONSTRAINT "pdr_ai_v2_email_campaign_approvals_template_version_id_pdr_ai_v2_email_template_versions_id_fk" FOREIGN KEY ("template_version_id") REFERENCES "public"."pdr_ai_v2_email_template_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_email_campaigns" ADD CONSTRAINT "pdr_ai_v2_email_campaigns_approved_version_id_pdr_ai_v2_email_template_versions_id_fk" FOREIGN KEY ("approved_version_id") REFERENCES "public"."pdr_ai_v2_email_template_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_email_recipients" ADD CONSTRAINT "pdr_ai_v2_email_recipients_campaign_id_pdr_ai_v2_email_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."pdr_ai_v2_email_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_email_send_attempts" ADD CONSTRAINT "pdr_ai_v2_email_send_attempts_campaign_id_pdr_ai_v2_email_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."pdr_ai_v2_email_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_email_send_attempts" ADD CONSTRAINT "pdr_ai_v2_email_send_attempts_template_version_id_pdr_ai_v2_email_template_versions_id_fk" FOREIGN KEY ("template_version_id") REFERENCES "public"."pdr_ai_v2_email_template_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_email_sends" ADD CONSTRAINT "pdr_ai_v2_email_sends_campaign_id_pdr_ai_v2_email_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."pdr_ai_v2_email_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_email_sends" ADD CONSTRAINT "pdr_ai_v2_email_sends_attempt_id_pdr_ai_v2_email_send_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."pdr_ai_v2_email_send_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_email_sends" ADD CONSTRAINT "pdr_ai_v2_email_sends_recipient_id_pdr_ai_v2_email_recipients_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."pdr_ai_v2_email_recipients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_email_template_versions" ADD CONSTRAINT "pdr_ai_v2_email_template_versions_campaign_id_pdr_ai_v2_email_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."pdr_ai_v2_email_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_campaign_approvals_campaign_idx" ON "pdr_ai_v2_email_campaign_approvals" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "email_campaign_approvals_version_idx" ON "pdr_ai_v2_email_campaign_approvals" USING btree ("template_version_id");--> statement-breakpoint
CREATE INDEX "email_campaigns_company_idx" ON "pdr_ai_v2_email_campaigns" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "email_campaigns_company_status_idx" ON "pdr_ai_v2_email_campaigns" USING btree ("company_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "email_campaigns_company_automation_key_uq" ON "pdr_ai_v2_email_campaigns" USING btree ("company_id","automation_key");--> statement-breakpoint
CREATE INDEX "email_recipients_campaign_idx" ON "pdr_ai_v2_email_recipients" USING btree ("campaign_id");--> statement-breakpoint
CREATE UNIQUE INDEX "email_recipients_campaign_email_uq" ON "pdr_ai_v2_email_recipients" USING btree ("campaign_id","email");--> statement-breakpoint
CREATE INDEX "email_send_attempts_campaign_idx" ON "pdr_ai_v2_email_send_attempts" USING btree ("campaign_id");--> statement-breakpoint
CREATE UNIQUE INDEX "email_send_attempts_campaign_key_uq" ON "pdr_ai_v2_email_send_attempts" USING btree ("campaign_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "email_sends_campaign_idx" ON "pdr_ai_v2_email_sends" USING btree ("campaign_id");--> statement-breakpoint
CREATE UNIQUE INDEX "email_sends_attempt_recipient_uq" ON "pdr_ai_v2_email_sends" USING btree ("attempt_id","recipient_email");--> statement-breakpoint
CREATE UNIQUE INDEX "email_sends_campaign_recipient_delivery_uq" ON "pdr_ai_v2_email_sends" USING btree ("campaign_id","recipient_email") WHERE status IN ('queued', 'sent');--> statement-breakpoint
CREATE UNIQUE INDEX "email_suppressions_company_email_uq" ON "pdr_ai_v2_email_suppressions" USING btree ("company_id","email");--> statement-breakpoint
CREATE INDEX "email_template_versions_campaign_idx" ON "pdr_ai_v2_email_template_versions" USING btree ("campaign_id");--> statement-breakpoint
CREATE UNIQUE INDEX "email_template_versions_campaign_version_uq" ON "pdr_ai_v2_email_template_versions" USING btree ("campaign_id","version");