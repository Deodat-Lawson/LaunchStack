CREATE TABLE "pdr_ai_v2_connector_deleted_item" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"connection_id" bigint NOT NULL,
	"source_id" varchar(128) NOT NULL,
	"picked_root_id" varchar(128),
	"title" text NOT NULL,
	"deleted_by_user_pk" bigint,
	"deleted_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_connector_deleted_item" ADD CONSTRAINT "pdr_ai_v2_connector_deleted_item_connection_id_pdr_ai_v2_connector_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."pdr_ai_v2_connector_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_connector_deleted_item" ADD CONSTRAINT "pdr_ai_v2_connector_deleted_item_deleted_by_user_pk_pdr_ai_v2_users_id_fk" FOREIGN KEY ("deleted_by_user_pk") REFERENCES "public"."pdr_ai_v2_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "connector_deleted_item_conn_source_idx" ON "pdr_ai_v2_connector_deleted_item" USING btree ("connection_id","source_id");