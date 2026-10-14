CREATE TABLE "pdr_ai_v2_brand_channels" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"connection_id" bigint NOT NULL,
	"platform" varchar(20) NOT NULL,
	"kind" varchar(20) NOT NULL,
	"external_id" varchar(256) NOT NULL,
	"name" varchar(256) NOT NULL,
	"handle" varchar(256),
	"avatar_url" text,
	"profile_url" text,
	"role" varchar(40),
	"enabled" boolean DEFAULT true NOT NULL,
	"capabilities" jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"status_reason" text,
	"followers" integer,
	"synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_brand_comments" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"channel_id" varchar(64) NOT NULL,
	"post_id" varchar(64) NOT NULL,
	"platform" varchar(20) NOT NULL,
	"external_id" varchar(512) NOT NULL,
	"parent_external_id" varchar(512),
	"refs" jsonb,
	"author_external_id" varchar(256),
	"author_name" varchar(256),
	"author_handle" varchar(256),
	"body" text NOT NULL,
	"is_own" boolean DEFAULT false NOT NULL,
	"commented_at" timestamp with time zone NOT NULL,
	"handled_at" timestamp with time zone,
	"handled_by_user_id" varchar(256),
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_brand_media" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"uploaded_by_user_id" varchar(256) NOT NULL,
	"storage_url" text NOT NULL,
	"mime_type" varchar(100) NOT NULL,
	"size" integer NOT NULL,
	"name" varchar(300),
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_brand_posts" ADD COLUMN "channel_id" varchar(64);--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_brand_posts" ADD COLUMN "media" jsonb;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_brand_posts" ADD COLUMN "metrics" jsonb;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_brand_posts" ADD COLUMN "metrics_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_brand_posts" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_brand_channels" ADD CONSTRAINT "pdr_ai_v2_brand_channels_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_brand_channels" ADD CONSTRAINT "pdr_ai_v2_brand_channels_connection_id_pdr_ai_v2_connector_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."pdr_ai_v2_connector_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_brand_comments" ADD CONSTRAINT "pdr_ai_v2_brand_comments_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_brand_comments" ADD CONSTRAINT "pdr_ai_v2_brand_comments_channel_id_pdr_ai_v2_brand_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."pdr_ai_v2_brand_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_brand_comments" ADD CONSTRAINT "pdr_ai_v2_brand_comments_post_id_pdr_ai_v2_brand_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."pdr_ai_v2_brand_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_brand_media" ADD CONSTRAINT "pdr_ai_v2_brand_media_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "brand_channels_company_platform_external_unique" ON "pdr_ai_v2_brand_channels" USING btree ("company_id","platform","external_id");--> statement-breakpoint
CREATE INDEX "brand_channels_connection_idx" ON "pdr_ai_v2_brand_channels" USING btree ("connection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "brand_comments_channel_external_unique" ON "pdr_ai_v2_brand_comments" USING btree ("channel_id","external_id");--> statement-breakpoint
CREATE INDEX "brand_comments_company_open_idx" ON "pdr_ai_v2_brand_comments" USING btree ("company_id","handled_at");--> statement-breakpoint
CREATE INDEX "brand_comments_post_idx" ON "pdr_ai_v2_brand_comments" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "brand_media_company_idx" ON "pdr_ai_v2_brand_media" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "brand_posts_channel_idx" ON "pdr_ai_v2_brand_posts" USING btree ("channel_id");