CREATE TABLE "pdr_ai_v2_ai_usage_daily" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"date" date NOT NULL,
	"feature" varchar(50) NOT NULL,
	"route" varchar(20) DEFAULT '' NOT NULL,
	"model_id" varchar(200) DEFAULT '' NOT NULL,
	"owner" varchar(20) NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL,
	"input_tokens" bigint DEFAULT 0 NOT NULL,
	"output_tokens" bigint DEFAULT 0 NOT NULL,
	"reasoning_tokens" bigint DEFAULT 0 NOT NULL,
	"cached_input_tokens" bigint DEFAULT 0 NOT NULL,
	"priced_calls" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(20, 10) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_ai_usage_daily" ADD CONSTRAINT "pdr_ai_v2_ai_usage_daily_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_usage_daily_row_key" ON "pdr_ai_v2_ai_usage_daily" USING btree ("company_id","date","feature","route","model_id","owner");