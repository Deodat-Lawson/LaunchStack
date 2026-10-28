-- launchstack:allow-dml
-- Reason: allowances and the usage page now add up weighted_tokens. Every row
-- written so far is a chat row, and a chat token counts as one, so the UPDATE
-- below carries each row over unchanged; without it everyone's usage this
-- month would read as zero at upgrade. One statement over one small daily
-- aggregate (no-op on a clean database), idempotent, so not a backfill job.
DROP INDEX "ai_usage_daily_row_key";--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_ai_usage_daily" ADD COLUMN "kind" varchar(20) DEFAULT 'chat' NOT NULL;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_ai_usage_daily" ADD COLUMN "weighted_tokens" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE "pdr_ai_v2_ai_usage_daily" SET "weighted_tokens" = "input_tokens" + "output_tokens";--> statement-breakpoint
CREATE UNIQUE INDEX "ai_usage_daily_row_key" ON "pdr_ai_v2_ai_usage_daily" USING btree ("company_id","date","feature","route","model_id","owner","user_id","kind");