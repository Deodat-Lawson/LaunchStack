-- launchstack:allow-dml
-- Reason: collection_input is NOT NULL with no default, and the UPDATE below is
-- what makes the SET NOT NULL valid. A backfill script runs after migrations,
-- which is too late to satisfy a constraint applied during them, so this data
-- change cannot move out of the migration. It is bounded and one-shot: it
-- touches only rows that predate the column, and re-running it matches nothing
-- because the column is NOT NULL afterwards.

CREATE TABLE "pdr_ai_v2_founder_weekly_review_dispatches" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"run_id" varchar(64) NOT NULL,
	"operation_type" varchar(16) NOT NULL,
	"operation_key" varchar(128) NOT NULL,
	"event_id" varchar(128) NOT NULL,
	"generation_job_id" varchar(128) NOT NULL,
	"generation_claim_id" varchar(128) NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"dispatched_at" timestamp with time zone,
	"last_error_code" varchar(128),
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_founder_weekly_review_runs" ALTER COLUMN "evidence_snapshot" DROP NOT NULL;--> statement-breakpoint
-- collection_input is NOT NULL with no default, so the generated single-
-- statement ADD COLUMN would fail on any table that already holds rows.
-- Split into the safe three-step form: add nullable, backfill, then constrain.
--
-- Every read parses this column through a strict contract requiring both
-- workspaceTimezone and actorExternalUserId, so a placeholder value would
-- satisfy the database and fail the application on the way out. Existing rows
-- carry both facts already: the timezone in the evidence snapshot they were
-- built with, and the actor in created_by_actor_id.
ALTER TABLE "pdr_ai_v2_founder_weekly_review_runs" ADD COLUMN "collection_input" jsonb;--> statement-breakpoint
UPDATE "pdr_ai_v2_founder_weekly_review_runs"
SET "collection_input" = jsonb_build_object(
    'workspaceTimezone', COALESCE("evidence_snapshot"->>'workspaceTimezone', 'UTC'),
    'actorExternalUserId', regexp_replace("created_by_actor_id", '^user:', '')
)
WHERE "collection_input" IS NULL;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_founder_weekly_review_runs" ALTER COLUMN "collection_input" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_founder_weekly_review_runs" ADD COLUMN "collection_claim_id" varchar(128);--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_founder_weekly_review_runs" ADD COLUMN "collection_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_founder_weekly_review_runs" ADD COLUMN "evidence_collected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_founder_weekly_review_dispatches" ADD CONSTRAINT "pdr_ai_v2_founder_weekly_review_dispatches_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_founder_weekly_review_dispatches" ADD CONSTRAINT "pdr_ai_v2_founder_weekly_review_dispatches_run_id_pdr_ai_v2_founder_weekly_review_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."pdr_ai_v2_founder_weekly_review_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "founder_weekly_review_dispatches_run_operation_key_unique" ON "pdr_ai_v2_founder_weekly_review_dispatches" USING btree ("run_id","operation_type","operation_key");--> statement-breakpoint
CREATE UNIQUE INDEX "founder_weekly_review_dispatches_event_id_unique" ON "pdr_ai_v2_founder_weekly_review_dispatches" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "founder_weekly_review_dispatches_pending_idx" ON "pdr_ai_v2_founder_weekly_review_dispatches" USING btree ("status","available_at","created_at");--> statement-breakpoint
CREATE INDEX "founder_weekly_review_dispatches_company_run_idx" ON "pdr_ai_v2_founder_weekly_review_dispatches" USING btree ("company_id","run_id");--> statement-breakpoint
CREATE INDEX "founder_weekly_review_runs_collection_claim_idx" ON "pdr_ai_v2_founder_weekly_review_runs" USING btree ("company_id","id","status","collection_claim_id");