CREATE TABLE "pdr_ai_v2_google_drive_picked_item" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"connection_id" bigint NOT NULL,
	"file_id" varchar(128) NOT NULL,
	"kind" varchar(8) NOT NULL,
	"name" text NOT NULL,
	"mime_type" varchar(255),
	"added_by_user_pk" bigint,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_google_drive_sync_state" (
	"connection_id" bigint PRIMARY KEY NOT NULL,
	"start_page_token" varchar(64),
	"last_sync_at" timestamp with time zone,
	"last_sync_status" varchar(16),
	"last_sync_error" text,
	"last_sync_report" jsonb,
	"sync_locked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_connector_connections" ALTER COLUMN "refresh_token_ciphertext" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_connector_connections" ADD COLUMN "access_token_ciphertext" text;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_connector_connections" ADD COLUMN "access_token_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_google_drive_picked_item" ADD CONSTRAINT "pdr_ai_v2_google_drive_picked_item_connection_id_pdr_ai_v2_connector_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."pdr_ai_v2_connector_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_google_drive_picked_item" ADD CONSTRAINT "pdr_ai_v2_google_drive_picked_item_added_by_user_pk_pdr_ai_v2_users_id_fk" FOREIGN KEY ("added_by_user_pk") REFERENCES "public"."pdr_ai_v2_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_google_drive_sync_state" ADD CONSTRAINT "pdr_ai_v2_google_drive_sync_state_connection_id_pdr_ai_v2_connector_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."pdr_ai_v2_connector_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gdrive_picked_conn_file_idx" ON "pdr_ai_v2_google_drive_picked_item" USING btree ("connection_id","file_id");--> statement-breakpoint
CREATE INDEX "gdrive_picked_connection_idx" ON "pdr_ai_v2_google_drive_picked_item" USING btree ("connection_id");