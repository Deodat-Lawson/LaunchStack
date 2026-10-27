CREATE TABLE "pdr_ai_v2_member_ai_limits" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"user_id" varchar(256) NOT NULL,
	"monthly_tokens" bigint,
	"updated_by" varchar(256),
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
DROP INDEX "ai_usage_daily_row_key";--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_ai_usage_daily" ADD COLUMN "user_id" varchar(256) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_member_ai_limits" ADD CONSTRAINT "pdr_ai_v2_member_ai_limits_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "member_ai_limits_company_user_idx" ON "pdr_ai_v2_member_ai_limits" USING btree ("company_id","user_id");--> statement-breakpoint
CREATE INDEX "ai_usage_daily_user_date_idx" ON "pdr_ai_v2_ai_usage_daily" USING btree ("user_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_usage_daily_row_key" ON "pdr_ai_v2_ai_usage_daily" USING btree ("company_id","date","feature","route","model_id","owner","user_id");