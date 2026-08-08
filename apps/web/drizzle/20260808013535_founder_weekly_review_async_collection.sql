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
ALTER TABLE "pdr_ai_v2_founder_weekly_review_runs" ADD COLUMN "collection_input" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
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