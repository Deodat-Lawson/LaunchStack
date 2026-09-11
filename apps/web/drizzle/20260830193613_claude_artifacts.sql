CREATE TABLE "pdr_ai_v2_claude_artifacts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"created_by_user_id" varchar(256) NOT NULL,
	"updated_by_user_id" varchar(256),
	"title" varchar(300) NOT NULL,
	"description" text,
	"folder" varchar(256) DEFAULT 'Unfiled' NOT NULL,
	"artifact_type" varchar(32) DEFAULT 'html' NOT NULL,
	"source_url" varchar(2048),
	"import_method" varchar(32) DEFAULT 'paste' NOT NULL,
	"content" text NOT NULL,
	"size_bytes" integer DEFAULT 0 NOT NULL,
	"content_hash" varchar(64) DEFAULT '' NOT NULL,
	"search_text" text,
	"starred" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"opened_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_claude_artifacts" ADD CONSTRAINT "pdr_ai_v2_claude_artifacts_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "claude_artifacts_company_idx" ON "pdr_ai_v2_claude_artifacts" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "claude_artifacts_company_updated_idx" ON "pdr_ai_v2_claude_artifacts" USING btree ("company_id","updated_at");--> statement-breakpoint
CREATE INDEX "claude_artifacts_creator_idx" ON "pdr_ai_v2_claude_artifacts" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "claude_artifacts_folder_idx" ON "pdr_ai_v2_claude_artifacts" USING btree ("company_id","folder");--> statement-breakpoint
CREATE INDEX "claude_artifacts_deleted_idx" ON "pdr_ai_v2_claude_artifacts" USING btree ("deleted_at");