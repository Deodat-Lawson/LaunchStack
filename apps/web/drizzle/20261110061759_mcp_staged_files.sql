CREATE TABLE "pdr_ai_v2_mcp_staged_files" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"user_id" bigint NOT NULL,
	"kind" varchar(16) NOT NULL,
	"status" varchar(16) NOT NULL,
	"upload_token_hash" varchar(64),
	"upload_expires_at" timestamp with time zone,
	"filename" varchar(256) NOT NULL,
	"mime_type" varchar(128) NOT NULL,
	"size_bytes" integer,
	"storage_url" text,
	"storage_provider" varchar(16),
	"details" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"document_id" bigint,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_mcp_staged_files" ADD CONSTRAINT "pdr_ai_v2_mcp_staged_files_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_mcp_staged_files" ADD CONSTRAINT "pdr_ai_v2_mcp_staged_files_user_id_pdr_ai_v2_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."pdr_ai_v2_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_staged_files_upload_token_unique" ON "pdr_ai_v2_mcp_staged_files" USING btree ("upload_token_hash");--> statement-breakpoint
CREATE INDEX "mcp_staged_files_company_user_idx" ON "pdr_ai_v2_mcp_staged_files" USING btree ("company_id","user_id");--> statement-breakpoint
CREATE INDEX "mcp_staged_files_expires_idx" ON "pdr_ai_v2_mcp_staged_files" USING btree ("expires_at");