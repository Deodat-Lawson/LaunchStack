ALTER TABLE "pdr_ai_v2_distribution_programs" ADD COLUMN "intent" varchar(16) DEFAULT 'partners' NOT NULL;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_partner_orgs" ADD COLUMN "image_url" varchar(2048);--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_partner_orgs" ADD COLUMN "icon_url" varchar(2048);--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_partner_orgs" ADD COLUMN "pictures_checked_at" timestamp with time zone;