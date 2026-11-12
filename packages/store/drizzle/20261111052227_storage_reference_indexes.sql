-- launchstack:no-transaction
-- Reason: Generated CREATE INDEX CONCURRENTLY statements must run outside a transaction to avoid blocking writes on existing document, version, upload, job, and batch tables.
CREATE INDEX CONCURRENTLY "document_url_idx" ON "pdr_ai_v2_document" USING btree ("url");--> statement-breakpoint
CREATE INDEX CONCURRENTLY "document_file_id_idx" ON "pdr_ai_v2_document" USING btree (((regexp_match("url", '/api/files/0*([0-9]+)([/?#]|$)'))[1]));--> statement-breakpoint
CREATE INDEX CONCURRENTLY "document_website_preview_url_idx" ON "pdr_ai_v2_document" USING btree (("ocr_metadata"->'websitePreview'->>'url'));--> statement-breakpoint
CREATE INDEX CONCURRENTLY "document_audio_url_idx" ON "pdr_ai_v2_document" USING btree (("ocr_metadata"->>'audioUrl'));--> statement-breakpoint
CREATE INDEX CONCURRENTLY "document_website_preview_file_id_idx" ON "pdr_ai_v2_document" USING btree (((regexp_match("ocr_metadata"->'websitePreview'->>'url', '/api/files/0*([0-9]+)([/?#]|$)'))[1]));--> statement-breakpoint
CREATE INDEX CONCURRENTLY "document_audio_file_id_idx" ON "pdr_ai_v2_document" USING btree (((regexp_match("ocr_metadata"->>'audioUrl', '/api/files/0*([0-9]+)([/?#]|$)'))[1]));--> statement-breakpoint
CREATE INDEX CONCURRENTLY "doc_versions_url_idx" ON "pdr_ai_v2_document_versions" USING btree ("url");--> statement-breakpoint
CREATE INDEX CONCURRENTLY "doc_versions_file_id_idx" ON "pdr_ai_v2_document_versions" USING btree (((regexp_match("url", '/api/files/0*([0-9]+)([/?#]|$)'))[1]));--> statement-breakpoint
CREATE INDEX CONCURRENTLY "doc_versions_website_preview_url_idx" ON "pdr_ai_v2_document_versions" USING btree (("ocr_metadata"->'websitePreview'->>'url'));--> statement-breakpoint
CREATE INDEX CONCURRENTLY "doc_versions_audio_url_idx" ON "pdr_ai_v2_document_versions" USING btree (("ocr_metadata"->>'audioUrl'));--> statement-breakpoint
CREATE INDEX CONCURRENTLY "doc_versions_website_preview_file_id_idx" ON "pdr_ai_v2_document_versions" USING btree (((regexp_match("ocr_metadata"->'websitePreview'->>'url', '/api/files/0*([0-9]+)([/?#]|$)'))[1]));--> statement-breakpoint
CREATE INDEX CONCURRENTLY "doc_versions_audio_file_id_idx" ON "pdr_ai_v2_document_versions" USING btree (((regexp_match("ocr_metadata"->>'audioUrl', '/api/files/0*([0-9]+)([/?#]|$)'))[1]));--> statement-breakpoint
CREATE INDEX CONCURRENTLY "file_uploads_storage_url_idx" ON "pdr_ai_v2_file_uploads" USING btree ("storage_url");--> statement-breakpoint
CREATE INDEX CONCURRENTLY "ocr_jobs_document_url_idx" ON "pdr_ai_v2_ocr_jobs" USING btree ("document_url");--> statement-breakpoint
CREATE INDEX CONCURRENTLY "ocr_jobs_document_file_id_idx" ON "pdr_ai_v2_ocr_jobs" USING btree (((regexp_match("document_url", '/api/files/0*([0-9]+)([/?#]|$)'))[1]));--> statement-breakpoint
CREATE INDEX CONCURRENTLY "upload_batch_files_storage_url_idx" ON "pdr_ai_v2_upload_batch_files" USING btree ("storage_url");--> statement-breakpoint
CREATE INDEX CONCURRENTLY "upload_batch_files_storage_file_id_idx" ON "pdr_ai_v2_upload_batch_files" USING btree (((regexp_match("storage_url", '/api/files/0*([0-9]+)([/?#]|$)'))[1]));