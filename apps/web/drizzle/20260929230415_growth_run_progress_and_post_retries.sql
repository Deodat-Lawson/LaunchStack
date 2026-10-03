ALTER TABLE "pdr_ai_v2_brand_posts" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_brand_posts" ADD COLUMN "next_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_brand_posts" ADD COLUMN "last_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_distribution_runs" ADD COLUMN "shortlisted_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_distribution_runs" ADD COLUMN "enriched_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_distribution_runs" ADD COLUMN "cancel_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_distribution_runs" ADD COLUMN "heartbeat_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "brand_posts_next_attempt_idx" ON "pdr_ai_v2_brand_posts" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "distribution_runs_program_live_unique" ON "pdr_ai_v2_distribution_runs" USING btree ("program_id") WHERE status not in ('completed', 'failed', 'stopped');