CREATE TABLE "pdr_ai_v2_brand_accounts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"platform" varchar(20) NOT NULL,
	"identity" varchar(256),
	"credentials_ciphertext" text NOT NULL,
	"encryption_key_version" integer DEFAULT 1 NOT NULL,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"last_error" text,
	"connected_by_user_id" varchar(256),
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "brand_accounts_company_platform_unique" ON "pdr_ai_v2_brand_accounts" USING btree ("company_id","platform");--> statement-breakpoint
CREATE INDEX "brand_accounts_company_idx" ON "pdr_ai_v2_brand_accounts" USING btree ("company_id");