CREATE TABLE "pdr_ai_v2_vantage_v2_plans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"review_id" uuid NOT NULL,
	"company_id" bigint NOT NULL,
	"owner_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"hash" text NOT NULL,
	"approved_version" integer,
	"approved_hash" text,
	"ciphertext" text NOT NULL,
	CONSTRAINT "vantage_v2_plan_review" UNIQUE("review_id"),
	CONSTRAINT "vantage_v2_plan_approval" CHECK (("pdr_ai_v2_vantage_v2_plans"."approved_version" IS NULL AND "pdr_ai_v2_vantage_v2_plans"."approved_hash" IS NULL) OR ("pdr_ai_v2_vantage_v2_plans"."approved_version"="pdr_ai_v2_vantage_v2_plans"."version" AND "pdr_ai_v2_vantage_v2_plans"."approved_hash"="pdr_ai_v2_vantage_v2_plans"."hash"))
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_vantage_v2_settings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"owner_id" text NOT NULL,
	"ciphertext" text NOT NULL,
	CONSTRAINT "vantage_v2_settings_owner" UNIQUE("company_id","owner_id")
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_vantage_v2_tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"plan_id" uuid NOT NULL,
	"topic_id" text NOT NULL,
	"parent_id" uuid,
	"assignee_type" text NOT NULL,
	"assignee_id" text NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"ciphertext" text NOT NULL,
	"claim_token" uuid,
	"attempt_id" uuid,
	"lease_until" timestamp with time zone,
	"attempt" integer DEFAULT 0 NOT NULL,
	"reason" text,
	"result_ciphertext" text,
	CONSTRAINT "vantage_v2_task_status" CHECK ("pdr_ai_v2_vantage_v2_tasks"."status" IN ('proposed','queued','running','submitted','completed','cancelled','failed','blocked')),
	CONSTRAINT "vantage_v2_task_assignee" CHECK ("pdr_ai_v2_vantage_v2_tasks"."assignee_type" IN ('owner','persona'))
);
--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_vantage_weekly_review_provider_attempts" DROP CONSTRAINT "vantage_review_provider_attempt_stage";--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_vantage_v2_plans" ADD CONSTRAINT "pdr_ai_v2_vantage_v2_plans_review_id_pdr_ai_v2_vantage_weekly_review_runs_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."pdr_ai_v2_vantage_weekly_review_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_vantage_v2_tasks" ADD CONSTRAINT "pdr_ai_v2_vantage_v2_tasks_plan_id_pdr_ai_v2_vantage_v2_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."pdr_ai_v2_vantage_v2_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vantage_v2_task_queue" ON "pdr_ai_v2_vantage_v2_tasks" USING btree ("status","lease_until");--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_vantage_weekly_review_provider_attempts" ADD CONSTRAINT "vantage_review_provider_attempt_stage" CHECK ("pdr_ai_v2_vantage_weekly_review_provider_attempts"."stage" IN ('digest','exploration','generation','judge','decomposition','task_execution'));