CREATE TABLE "pdr_ai_v2_marketing_runs" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"user_id" varchar(256) NOT NULL,
	"status" varchar(16) DEFAULT 'queued' NOT NULL,
	"input" jsonb NOT NULL,
	"debug" boolean DEFAULT false NOT NULL,
	"events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"checkpoints" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" jsonb,
	"error_message" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"started_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_marketing_runs" ADD CONSTRAINT "pdr_ai_v2_marketing_runs_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "marketing_runs_company_status_idx" ON "pdr_ai_v2_marketing_runs" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "marketing_runs_user_created_idx" ON "pdr_ai_v2_marketing_runs" USING btree ("user_id","created_at");