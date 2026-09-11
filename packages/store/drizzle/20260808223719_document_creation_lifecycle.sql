ALTER TABLE "pdr_ai_v2_document" ADD COLUMN "source_archive_entry" varchar(1024);--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_document" ADD COLUMN "creation_key" varchar(512);--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_document_versions" ADD COLUMN "creation_key" varchar(512);--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_ocr_jobs" ADD COLUMN "version_id" bigint;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_ocr_jobs" ADD COLUMN "dispatch_options" jsonb;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_ocr_jobs" ADD CONSTRAINT "pdr_ai_v2_ocr_jobs_version_id_pdr_ai_v2_document_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."pdr_ai_v2_document_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_company_creation_key_unique" ON "pdr_ai_v2_document" USING btree ("company_id","creation_key");--> statement-breakpoint
CREATE UNIQUE INDEX "doc_versions_document_creation_key_unique" ON "pdr_ai_v2_document_versions" USING btree ("document_id","creation_key");--> statement-breakpoint
CREATE INDEX "ocr_jobs_document_id_idx" ON "pdr_ai_v2_ocr_jobs" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "ocr_jobs_version_id_idx" ON "pdr_ai_v2_ocr_jobs" USING btree ("version_id");