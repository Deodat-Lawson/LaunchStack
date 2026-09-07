CREATE TABLE "pdr_ai_v2_mindmap_revisions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"mindmap_id" bigint NOT NULL,
	"revision" integer NOT NULL,
	"doc" jsonb NOT NULL,
	"author_user_id" varchar(256),
	"label" varchar(200),
	"node_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_mindmaps" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"created_by_user_id" varchar(256) NOT NULL,
	"updated_by_user_id" varchar(256),
	"title" varchar(300) NOT NULL,
	"description" text,
	"template_id" varchar(64),
	"folder" varchar(256) DEFAULT 'Unfiled' NOT NULL,
	"doc" jsonb NOT NULL,
	"doc_version" integer DEFAULT 1 NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"thumbnail" text,
	"search_text" text,
	"node_count" integer DEFAULT 0 NOT NULL,
	"edge_count" integer DEFAULT 0 NOT NULL,
	"starred" boolean DEFAULT false NOT NULL,
	"published_document_id" bigint,
	"published_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"opened_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_mindmap_revisions" ADD CONSTRAINT "pdr_ai_v2_mindmap_revisions_mindmap_id_pdr_ai_v2_mindmaps_id_fk" FOREIGN KEY ("mindmap_id") REFERENCES "public"."pdr_ai_v2_mindmaps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_mindmaps" ADD CONSTRAINT "pdr_ai_v2_mindmaps_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mindmap_revisions_map_idx" ON "pdr_ai_v2_mindmap_revisions" USING btree ("mindmap_id","revision");--> statement-breakpoint
CREATE INDEX "mindmap_revisions_created_idx" ON "pdr_ai_v2_mindmap_revisions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "mindmaps_company_idx" ON "pdr_ai_v2_mindmaps" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "mindmaps_company_updated_idx" ON "pdr_ai_v2_mindmaps" USING btree ("company_id","updated_at");--> statement-breakpoint
CREATE INDEX "mindmaps_creator_idx" ON "pdr_ai_v2_mindmaps" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "mindmaps_folder_idx" ON "pdr_ai_v2_mindmaps" USING btree ("company_id","folder");--> statement-breakpoint
CREATE INDEX "mindmaps_deleted_idx" ON "pdr_ai_v2_mindmaps" USING btree ("deleted_at");