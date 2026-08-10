CREATE TABLE "pdr_ai_v2_workspace_comments" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"page_id" varchar(36) NOT NULL,
	"user_id" varchar(256) NOT NULL,
	"author_name" text,
	"author_avatar" text,
	"block_id" varchar(36),
	"anchor_text" text,
	"parent_comment_id" bigint,
	"body" text NOT NULL,
	"resolved" boolean DEFAULT false NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" varchar(256),
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_workspace_databases" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"user_id" varchar(256) NOT NULL,
	"company_id" varchar(256),
	"page_id" varchar(36) NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"description" text,
	"icon" jsonb,
	"properties" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"views" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_inline" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_workspace_page_links" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source_page_id" varchar(36) NOT NULL,
	"target_page_id" varchar(36) NOT NULL,
	"user_id" varchar(256) NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_workspace_page_versions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"page_id" varchar(36) NOT NULL,
	"user_id" varchar(256) NOT NULL,
	"title" text,
	"icon" jsonb,
	"content" jsonb,
	"label" text,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_workspace_pages" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"user_id" varchar(256) NOT NULL,
	"company_id" varchar(256),
	"parent_page_id" varchar(36),
	"parent_type" varchar(16) DEFAULT 'workspace' NOT NULL,
	"database_id" varchar(36),
	"title" text DEFAULT '' NOT NULL,
	"icon" jsonb,
	"cover" jsonb,
	"content" jsonb,
	"content_text" text,
	"properties" jsonb,
	"font" varchar(16) DEFAULT 'default' NOT NULL,
	"small_text" boolean DEFAULT false NOT NULL,
	"full_width" boolean DEFAULT false NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"is_favorite" boolean DEFAULT false NOT NULL,
	"is_template" boolean DEFAULT false NOT NULL,
	"in_trash" boolean DEFAULT false NOT NULL,
	"trashed_at" timestamp with time zone,
	"position" double precision DEFAULT 0 NOT NULL,
	"public_slug" varchar(64),
	"created_by" varchar(256),
	"last_edited_by" varchar(256),
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX "workspace_comments_page_idx" ON "pdr_ai_v2_workspace_comments" USING btree ("page_id");--> statement-breakpoint
CREATE INDEX "workspace_comments_block_idx" ON "pdr_ai_v2_workspace_comments" USING btree ("block_id");--> statement-breakpoint
CREATE INDEX "workspace_comments_thread_idx" ON "pdr_ai_v2_workspace_comments" USING btree ("parent_comment_id");--> statement-breakpoint
CREATE INDEX "workspace_databases_user_idx" ON "pdr_ai_v2_workspace_databases" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "workspace_databases_page_idx" ON "pdr_ai_v2_workspace_databases" USING btree ("page_id");--> statement-breakpoint
CREATE INDEX "workspace_page_links_source_idx" ON "pdr_ai_v2_workspace_page_links" USING btree ("source_page_id");--> statement-breakpoint
CREATE INDEX "workspace_page_links_target_idx" ON "pdr_ai_v2_workspace_page_links" USING btree ("target_page_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_page_links_pair_idx" ON "pdr_ai_v2_workspace_page_links" USING btree ("source_page_id","target_page_id");--> statement-breakpoint
CREATE INDEX "workspace_page_versions_page_idx" ON "pdr_ai_v2_workspace_page_versions" USING btree ("page_id","created_at");--> statement-breakpoint
CREATE INDEX "workspace_pages_user_idx" ON "pdr_ai_v2_workspace_pages" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "workspace_pages_parent_idx" ON "pdr_ai_v2_workspace_pages" USING btree ("parent_page_id");--> statement-breakpoint
CREATE INDEX "workspace_pages_company_idx" ON "pdr_ai_v2_workspace_pages" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "workspace_pages_database_idx" ON "pdr_ai_v2_workspace_pages" USING btree ("database_id");--> statement-breakpoint
CREATE INDEX "workspace_pages_trash_idx" ON "pdr_ai_v2_workspace_pages" USING btree ("user_id","in_trash");--> statement-breakpoint
CREATE INDEX "workspace_pages_updated_idx" ON "pdr_ai_v2_workspace_pages" USING btree ("updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_pages_public_slug_idx" ON "pdr_ai_v2_workspace_pages" USING btree ("public_slug");