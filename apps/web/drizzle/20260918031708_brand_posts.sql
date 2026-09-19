CREATE TABLE "pdr_ai_v2_brand_posts" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"created_by_user_id" varchar(256) NOT NULL,
	"platform" varchar(20) NOT NULL,
	"body" text NOT NULL,
	"title" varchar(300),
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"post_id" varchar(200),
	"post_url" varchar(500),
	"error" text,
	"source" jsonb,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "brand_posts_company_status_idx" ON "pdr_ai_v2_brand_posts" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "brand_posts_company_scheduled_idx" ON "pdr_ai_v2_brand_posts" USING btree ("company_id","scheduled_at");--> statement-breakpoint
CREATE INDEX "brand_posts_due_idx" ON "pdr_ai_v2_brand_posts" USING btree ("status","scheduled_at");