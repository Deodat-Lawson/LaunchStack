CREATE TABLE "pdr_ai_v2_document_version_digests" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"document_id" bigint NOT NULL,
	"version_id" bigint NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"format_version" varchar(32) NOT NULL,
	"headline" text NOT NULL,
	"items" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_document_version_digests" ADD CONSTRAINT "pdr_ai_v2_document_version_digests_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_document_version_digests" ADD CONSTRAINT "pdr_ai_v2_document_version_digests_document_id_pdr_ai_v2_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."pdr_ai_v2_document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_document_version_digests" ADD CONSTRAINT "pdr_ai_v2_document_version_digests_version_id_pdr_ai_v2_document_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."pdr_ai_v2_document_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_version_digests_key" ON "pdr_ai_v2_document_version_digests" USING btree ("version_id","content_hash","format_version");