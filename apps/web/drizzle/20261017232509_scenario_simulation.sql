CREATE TABLE "pdr_ai_v2_scenario_injections" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"company_id" bigint NOT NULL,
	"created_by_user_id" varchar(256) NOT NULL,
	"text" text NOT NULL,
	"applied_round" integer,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_scenario_interviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"company_id" bigint NOT NULL,
	"asked_by_user_id" varchar(256) NOT NULL,
	"agent_id" varchar(32) NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_scenario_post_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"company_id" bigint NOT NULL,
	"brand_post_id" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_scenario_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"created_by_user_id" varchar(256) NOT NULL,
	"kind" varchar(16) NOT NULL,
	"title" varchar(200) NOT NULL,
	"subject" text NOT NULL,
	"status" varchar(16) DEFAULT 'queued' NOT NULL,
	"step" integer DEFAULT 0 NOT NULL,
	"agent_count" integer NOT NULL,
	"round_count" integer NOT NULL,
	"seed" integer NOT NULL,
	"sources" jsonb NOT NULL,
	"evidence" jsonb,
	"brief" jsonb,
	"world" jsonb,
	"report" jsonb,
	"reception" jsonb,
	"estimate" jsonb NOT NULL,
	"usage" jsonb NOT NULL,
	"draft" jsonb,
	"draft_hash" varchar(64),
	"error" text,
	"shared_at" timestamp with time zone,
	"cancel_requested_at" timestamp with time zone,
	"lease_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"events_closed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_scenario_injections" ADD CONSTRAINT "pdr_ai_v2_scenario_injections_run_id_pdr_ai_v2_scenario_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."pdr_ai_v2_scenario_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_scenario_injections" ADD CONSTRAINT "pdr_ai_v2_scenario_injections_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_scenario_interviews" ADD CONSTRAINT "pdr_ai_v2_scenario_interviews_run_id_pdr_ai_v2_scenario_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."pdr_ai_v2_scenario_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_scenario_interviews" ADD CONSTRAINT "pdr_ai_v2_scenario_interviews_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_scenario_post_links" ADD CONSTRAINT "pdr_ai_v2_scenario_post_links_run_id_pdr_ai_v2_scenario_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."pdr_ai_v2_scenario_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_scenario_post_links" ADD CONSTRAINT "pdr_ai_v2_scenario_post_links_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_scenario_runs" ADD CONSTRAINT "pdr_ai_v2_scenario_runs_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scenario_injections_run_idx" ON "pdr_ai_v2_scenario_injections" USING btree ("run_id","applied_round");--> statement-breakpoint
CREATE INDEX "scenario_interviews_run_asker_idx" ON "pdr_ai_v2_scenario_interviews" USING btree ("run_id","asked_by_user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "scenario_post_links_post_unique" ON "pdr_ai_v2_scenario_post_links" USING btree ("brand_post_id");--> statement-breakpoint
CREATE INDEX "scenario_post_links_company_idx" ON "pdr_ai_v2_scenario_post_links" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "scenario_runs_company_creator_idx" ON "pdr_ai_v2_scenario_runs" USING btree ("company_id","created_by_user_id","created_at");--> statement-breakpoint
CREATE INDEX "scenario_runs_company_kind_idx" ON "pdr_ai_v2_scenario_runs" USING btree ("company_id","kind","created_at");--> statement-breakpoint
CREATE INDEX "scenario_runs_status_idx" ON "pdr_ai_v2_scenario_runs" USING btree ("status");