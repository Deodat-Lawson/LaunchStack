CREATE TABLE "pdr_ai_v2_document_public_links" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"document_id" bigint NOT NULL,
	"token" varchar(64) NOT NULL,
	"allow_download" boolean DEFAULT true NOT NULL,
	"expires_at" timestamp with time zone,
	"created_by" varchar(256) NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" varchar(256)
);
--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_document_public_links" ADD CONSTRAINT "pdr_ai_v2_document_public_links_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_document_public_links" ADD CONSTRAINT "pdr_ai_v2_document_public_links_document_id_pdr_ai_v2_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."pdr_ai_v2_document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_public_links_token_unique" ON "pdr_ai_v2_document_public_links" USING btree ("token");--> statement-breakpoint
CREATE UNIQUE INDEX "document_public_links_live_document_unique" ON "pdr_ai_v2_document_public_links" USING btree ("document_id") WHERE revoked_at is null;--> statement-breakpoint
CREATE INDEX "document_public_links_company_id_idx" ON "pdr_ai_v2_document_public_links" USING btree ("company_id");