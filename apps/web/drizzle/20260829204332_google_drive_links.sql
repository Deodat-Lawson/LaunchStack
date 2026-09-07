CREATE TABLE "pdr_ai_v2_connector_connections" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"provider" varchar(32) NOT NULL,
	"provider_account_id" varchar(256) NOT NULL,
	"provider_account_email" varchar(256),
	"granted_by_user_id" bigint,
	"refresh_token_ciphertext" text NOT NULL,
	"encryption_key_version" integer DEFAULT 1 NOT NULL,
	"scopes" varchar(512) NOT NULL,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"last_refresh_error" text,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_document_drive_links" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"document_id" bigint NOT NULL,
	"connection_id" bigint NOT NULL,
	"linked_by_user_id" bigint,
	"drive_file_id" varchar(128) NOT NULL,
	"drive_web_view_link" varchar(1024),
	"base_version_id" bigint,
	"last_synced_version_id" bigint,
	"last_synced_revision_id" varchar(128),
	"last_synced_md5" varchar(64),
	"status" varchar(16) DEFAULT 'linked' NOT NULL,
	"fidelity_warning" boolean DEFAULT false NOT NULL,
	"last_checked_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_connector_connections" ADD CONSTRAINT "pdr_ai_v2_connector_connections_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_connector_connections" ADD CONSTRAINT "pdr_ai_v2_connector_connections_granted_by_user_id_pdr_ai_v2_users_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."pdr_ai_v2_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_document_drive_links" ADD CONSTRAINT "pdr_ai_v2_document_drive_links_document_id_pdr_ai_v2_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."pdr_ai_v2_document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_document_drive_links" ADD CONSTRAINT "pdr_ai_v2_document_drive_links_connection_id_pdr_ai_v2_connector_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."pdr_ai_v2_connector_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_document_drive_links" ADD CONSTRAINT "pdr_ai_v2_document_drive_links_linked_by_user_id_pdr_ai_v2_users_id_fk" FOREIGN KEY ("linked_by_user_id") REFERENCES "public"."pdr_ai_v2_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_document_drive_links" ADD CONSTRAINT "pdr_ai_v2_document_drive_links_base_version_id_pdr_ai_v2_document_versions_id_fk" FOREIGN KEY ("base_version_id") REFERENCES "public"."pdr_ai_v2_document_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_document_drive_links" ADD CONSTRAINT "pdr_ai_v2_document_drive_links_last_synced_version_id_pdr_ai_v2_document_versions_id_fk" FOREIGN KEY ("last_synced_version_id") REFERENCES "public"."pdr_ai_v2_document_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "connector_connections_company_provider_account_unique" ON "pdr_ai_v2_connector_connections" USING btree ("company_id","provider","provider_account_id");--> statement-breakpoint
CREATE INDEX "connector_connections_company_provider_idx" ON "pdr_ai_v2_connector_connections" USING btree ("company_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "document_drive_links_document_unique" ON "pdr_ai_v2_document_drive_links" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "document_drive_links_connection_idx" ON "pdr_ai_v2_document_drive_links" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "document_drive_links_status_checked_idx" ON "pdr_ai_v2_document_drive_links" USING btree ("status","last_checked_at");