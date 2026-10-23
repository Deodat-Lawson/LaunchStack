CREATE TABLE "pdr_ai_v2_notion_sync_state" (
	"connection_id" bigint PRIMARY KEY NOT NULL,
	"folder_category_id" bigint,
	"last_sync_at" timestamp with time zone,
	"last_sync_status" varchar(16),
	"last_sync_error" text,
	"last_sync_report" jsonb,
	"sync_locked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_notion_sync_state" ADD CONSTRAINT "pdr_ai_v2_notion_sync_state_connection_id_pdr_ai_v2_connector_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."pdr_ai_v2_connector_connections"("id") ON DELETE cascade ON UPDATE no action;