CREATE TABLE "pdr_ai_v2_founder_weekly_review_operations" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"run_id" varchar(64) NOT NULL,
	"company_id" bigint NOT NULL,
	"operation_type" varchar(32) NOT NULL,
	"request_key" varchar(128) NOT NULL,
	"source_failure_sequence" integer NOT NULL,
	"actor_id" varchar(256) NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_founder_weekly_review_runs" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"request_key" varchar(128) NOT NULL,
	"reporting_period_start" date NOT NULL,
	"reporting_period_end" date NOT NULL,
	"status" varchar(32) DEFAULT 'queued' NOT NULL,
	"review_payload" jsonb,
	"review_schema_version" varchar(64) NOT NULL,
	"evidence_snapshot" jsonb NOT NULL,
	"evidence_schema_version" varchar(64) NOT NULL,
	"model_metadata" jsonb,
	"created_by_actor_id" varchar(256) NOT NULL,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"failure_sequence" integer DEFAULT 0 NOT NULL,
	"generation_attempt" integer DEFAULT 0 NOT NULL,
	"generation_claim_id" varchar(128),
	"generation_job_id" varchar(256),
	"queued_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"claimed_at" timestamp with time zone,
	"generation_started_at" timestamp with time zone,
	"generated_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"error_code" varchar(128),
	"error_message" varchar(1024),
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_founder_weekly_review_operations" ADD CONSTRAINT "pdr_ai_v2_founder_weekly_review_operations_run_id_pdr_ai_v2_founder_weekly_review_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."pdr_ai_v2_founder_weekly_review_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_founder_weekly_review_operations" ADD CONSTRAINT "pdr_ai_v2_founder_weekly_review_operations_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_founder_weekly_review_runs" ADD CONSTRAINT "pdr_ai_v2_founder_weekly_review_runs_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "founder_weekly_review_operations_run_type_request_key_unique" ON "pdr_ai_v2_founder_weekly_review_operations" USING btree ("run_id","operation_type","request_key");--> statement-breakpoint
CREATE INDEX "founder_weekly_review_operations_company_run_created_at_idx" ON "pdr_ai_v2_founder_weekly_review_operations" USING btree ("company_id","run_id","created_at");--> statement-breakpoint
CREATE INDEX "founder_weekly_review_operations_run_type_created_at_idx" ON "pdr_ai_v2_founder_weekly_review_operations" USING btree ("run_id","operation_type","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "founder_weekly_review_runs_company_request_key_unique" ON "pdr_ai_v2_founder_weekly_review_runs" USING btree ("company_id","request_key");--> statement-breakpoint
CREATE INDEX "founder_weekly_review_runs_company_created_at_idx" ON "pdr_ai_v2_founder_weekly_review_runs" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "founder_weekly_review_runs_company_status_created_at_idx" ON "pdr_ai_v2_founder_weekly_review_runs" USING btree ("company_id","status","created_at");--> statement-breakpoint
CREATE INDEX "founder_weekly_review_runs_company_period_idx" ON "pdr_ai_v2_founder_weekly_review_runs" USING btree ("company_id","reporting_period_start","reporting_period_end");--> statement-breakpoint
CREATE INDEX "founder_weekly_review_runs_claim_idx" ON "pdr_ai_v2_founder_weekly_review_runs" USING btree ("company_id","id","status","generation_claim_id");