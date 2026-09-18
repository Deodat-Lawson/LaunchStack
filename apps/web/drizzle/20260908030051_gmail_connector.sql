CREATE TABLE "pdr_ai_v2_gmail_sync_scope" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"connection_id" bigint NOT NULL,
	"kind" varchar(8) NOT NULL,
	"value" varchar(512) NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_gmail_sync_state" (
	"connection_id" bigint PRIMARY KEY NOT NULL,
	"history_id" varchar(64),
	"last_sync_at" timestamp with time zone,
	"last_sync_status" varchar(16),
	"last_sync_error" text,
	"last_sync_report" jsonb,
	"sync_locked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_connector_connections" ADD COLUMN "owner_user_id" bigint;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_gmail_sync_scope" ADD CONSTRAINT "pdr_ai_v2_gmail_sync_scope_connection_id_pdr_ai_v2_connector_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."pdr_ai_v2_connector_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_gmail_sync_state" ADD CONSTRAINT "pdr_ai_v2_gmail_sync_state_connection_id_pdr_ai_v2_connector_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."pdr_ai_v2_connector_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gmail_scope_conn_kind_value_idx" ON "pdr_ai_v2_gmail_sync_scope" USING btree ("connection_id","kind","value");--> statement-breakpoint
CREATE INDEX "gmail_scope_connection_idx" ON "pdr_ai_v2_gmail_sync_scope" USING btree ("connection_id");--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_connector_connections" ADD CONSTRAINT "pdr_ai_v2_connector_connections_owner_user_id_pdr_ai_v2_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."pdr_ai_v2_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "connector_connections_company_provider_owner_unique" ON "pdr_ai_v2_connector_connections" USING btree ("company_id","provider","owner_user_id") WHERE owner_user_id is not null;