CREATE TABLE "pdr_ai_v2_profile_images" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"company_id" bigint,
	"mime_type" varchar(32) NOT NULL,
	"data" "bytea" NOT NULL,
	"byte_size" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_user_company_memberships" ADD COLUMN "profile_display_name" varchar(80);--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_user_company_memberships" ADD COLUMN "profile_title" varchar(100);--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_users" ADD COLUMN "display_name" varchar(80);--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_users" ADD COLUMN "title" varchar(100);--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_users" ADD COLUMN "pronouns" varchar(40);--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_users" ADD COLUMN "time_zone" varchar(64);--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_users" ADD COLUMN "bio" varchar(280);--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_users" ADD COLUMN "provider_photo_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_profile_images" ADD CONSTRAINT "pdr_ai_v2_profile_images_user_id_pdr_ai_v2_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."pdr_ai_v2_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_profile_images" ADD CONSTRAINT "pdr_ai_v2_profile_images_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "profile_images_user_global_unique" ON "pdr_ai_v2_profile_images" USING btree ("user_id") WHERE company_id is null;--> statement-breakpoint
CREATE UNIQUE INDEX "profile_images_user_company_unique" ON "pdr_ai_v2_profile_images" USING btree ("user_id","company_id") WHERE company_id is not null;--> statement-breakpoint
CREATE INDEX "profile_images_company_id_idx" ON "pdr_ai_v2_profile_images" USING btree ("company_id");