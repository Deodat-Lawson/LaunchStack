CREATE TABLE "pdr_ai_v2_mindmap_presence" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"mindmap_id" bigint NOT NULL,
	"user_id" varchar(256) NOT NULL,
	"display_name" varchar(256),
	"page_id" varchar(64),
	"cursor_x" integer,
	"cursor_y" integer,
	"selection" jsonb,
	"revision_seen" integer DEFAULT 0 NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_mindmap_presence" ADD CONSTRAINT "pdr_ai_v2_mindmap_presence_mindmap_id_pdr_ai_v2_mindmaps_id_fk" FOREIGN KEY ("mindmap_id") REFERENCES "public"."pdr_ai_v2_mindmaps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mindmap_presence_map_user_idx" ON "pdr_ai_v2_mindmap_presence" USING btree ("mindmap_id","user_id");--> statement-breakpoint
CREATE INDEX "mindmap_presence_seen_idx" ON "pdr_ai_v2_mindmap_presence" USING btree ("mindmap_id","last_seen_at");