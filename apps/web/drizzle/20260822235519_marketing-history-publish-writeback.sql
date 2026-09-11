ALTER TABLE "pdr_ai_v2_marketing_content_history" ADD COLUMN "post_id" varchar(200);--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_marketing_content_history" ADD COLUMN "post_url" varchar(500);--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_marketing_content_history" ADD COLUMN "published_at" timestamp;